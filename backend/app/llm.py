"""Meeting-notes generation through a self-hosted Ollama server."""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
from typing import Literal, Optional

import httpx
from pydantic import BaseModel, Field

from . import prompts
from .config import settings

log = logging.getLogger("meetnotes.llm")

NOTES_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "decisions": {"type": "array", "items": {"type": "string"}},
        "action_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string"},
                    "task": {"type": "string"},
                    "due_date": {"type": "string"},
                },
                "required": ["owner", "task", "due_date"],
            },
        },
        "open_questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "key_points", "decisions", "action_items", "open_questions"],
}


class ActionItem(BaseModel):
    owner: str = ""
    task: str
    due_date: str = ""


class Notes(BaseModel):
    summary: str = ""
    key_points: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class NotesRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=500_000)
    meeting_language: Optional[str] = None
    output_language: Literal["same", "en", "hi", "ta"] = "same"
    style: Literal["concise", "detailed", "bullet"] = "concise"
    model: Optional[str] = None
    title: Optional[str] = Field(default=None, max_length=300)
    meeting_date: Optional[str] = None
    manual_notes: Optional[str] = Field(default=None, max_length=50_000)


class LLMError(Exception):
    pass


async def list_models() -> list[str]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"{settings.ollama_url}/api/tags")
        response.raise_for_status()
    return sorted(m["name"] for m in response.json().get("models", []))


async def ping() -> tuple[bool, Optional[str]]:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            (await client.get(f"{settings.ollama_url}/api/version")).raise_for_status()
        return True, None
    except Exception as exc:  # noqa: BLE001
        return False, f"Ollama not reachable at {settings.ollama_url}: {exc.__class__.__name__}"


def _parse_json(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    raise LLMError("The model did not return valid JSON. Try again or choose a larger model.")


def _as_text(value) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return " — ".join(str(v).strip() for v in value.values() if str(v).strip())
    return "" if value is None else str(value).strip()


def _coerce(data: dict) -> Notes:
    """Normalise slightly-off model output into the Notes schema."""
    def strings(key: str) -> list[str]:
        value = data.get(key) or []
        if isinstance(value, str):
            value = [line.lstrip("-•* ").strip() for line in value.splitlines()]
        return [s for s in (_as_text(v) for v in value) if s]

    items = []
    for raw in data.get("action_items") or []:
        if isinstance(raw, str):
            raw = {"task": raw}
        if not isinstance(raw, dict):
            continue
        task = _as_text(raw.get("task") or raw.get("action") or raw.get("item"))
        if task:
            items.append(ActionItem(
                owner=_as_text(raw.get("owner") or raw.get("assignee")),
                task=task,
                due_date=_as_text(raw.get("due_date") or raw.get("due") or raw.get("deadline")),
            ))
    summary = data.get("summary")
    if isinstance(summary, list):
        summary = " ".join(_as_text(s) for s in summary)
    return Notes(
        summary=_as_text(summary),
        key_points=strings("key_points"),
        decisions=strings("decisions"),
        action_items=items,
        open_questions=strings("open_questions"),
    )


async def _chat(model: str, system: str, user: str) -> dict:
    payload = {
        "model": model,
        "stream": False,
        "format": NOTES_SCHEMA,
        "keep_alive": settings.ollama_keep_alive,
        "options": {"temperature": settings.llm_temperature, "num_ctx": settings.ollama_num_ctx},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    try:
        async with httpx.AsyncClient(timeout=settings.ollama_timeout) as client:
            response = await client.post(f"{settings.ollama_url}/api/chat", json=payload)
    except httpx.HTTPError as exc:
        raise LLMError(f"Could not reach Ollama at {settings.ollama_url} ({exc.__class__.__name__})") from exc
    if response.status_code == 404:
        raise LLMError(f"Model '{model}' is not installed in Ollama. Run: ollama pull {model}")
    if response.status_code >= 400:
        raise LLMError(f"Ollama error {response.status_code}: {response.text[:300]}")
    return _parse_json(response.json().get("message", {}).get("content", ""))


def split_transcript(text: str, limit: int) -> list[str]:
    """Split on line/sentence boundaries into chunks of at most ~limit characters."""
    if len(text) <= limit:
        return [text]
    pieces = re.split(r"(?<=[\n.!?।])\s+", text)
    chunks, current = [], ""
    for piece in pieces:
        while len(piece) > limit:  # a single enormous "sentence"
            chunks.append(piece[:limit])
            piece = piece[limit:]
        if current and len(current) + len(piece) + 1 > limit:
            chunks.append(current)
            current = piece
        else:
            current = f"{current} {piece}".strip() if current else piece
    if current:
        chunks.append(current)
    return chunks


async def generate_notes(req: NotesRequest, progress=None) -> tuple[Notes, str]:
    model = req.model or settings.ollama_model
    date = req.meeting_date or dt.date.today().isoformat()
    chunks = split_transcript(req.transcript, settings.llm_chunk_chars)
    if len(chunks) == 1:
        system = prompts.system_prompt(req.output_language, req.meeting_language, req.style, date)
        data = await _chat(model, system, prompts.user_prompt(chunks[0], req.title, date, req.manual_notes))
        return _coerce(data), model

    partials = []
    for index, chunk in enumerate(chunks, start=1):
        system = prompts.system_prompt(req.output_language, req.meeting_language, req.style, date, (index, len(chunks)))
        notes = _coerce(await _chat(model, system, prompts.user_prompt(chunk, req.title, date, None)))
        partials.append(notes.model_dump())
        if progress:
            progress(index / (len(chunks) + 1))
    merge_input = prompts.user_prompt(json.dumps(partials, ensure_ascii=False), req.title, date, req.manual_notes)
    merged = await _chat(model, prompts.merge_prompt(req.output_language, req.meeting_language, req.style, date), merge_input)
    return _coerce(merged), model
