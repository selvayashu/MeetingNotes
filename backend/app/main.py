"""MeetNotes API: self-hosted transcription (faster-whisper / IndicWhisper / IndicConformer),
meeting notes (Ollama) and optional speaker labels (pyannote.audio)."""

from __future__ import annotations

import hmac
import json
import logging
import os
import shutil
import tempfile
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from . import __version__, llm
from .config import settings
from .jobs import store
from .stt import VALID_MODES, decode, router

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("meetnotes")

app = FastAPI(title="MeetNotes API", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)


def require_token(authorization: Optional[str] = Header(default=None)) -> None:
    """Optional shared secret so a public server is not open to anyone (set ACCESS_TOKEN)."""
    if not settings.access_token:
        return
    expected = f"Bearer {settings.access_token}"
    if not authorization or not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Missing or invalid access token")


auth = [Depends(require_token)]


def _check_mode(language: str) -> str:
    language = (language or "auto").lower()
    if language not in VALID_MODES:
        raise HTTPException(422, f"language must be one of {sorted(VALID_MODES)}")
    return language


def _check_size(file: UploadFile) -> None:
    if file.size is not None and file.size > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File larger than {settings.max_upload_mb} MB")


async def _save_upload(file: UploadFile) -> str:
    _check_size(file)
    suffix = os.path.splitext(file.filename or "")[1] or ".bin"
    fd, path = tempfile.mkstemp(prefix="meetnotes-", suffix=suffix)
    with os.fdopen(fd, "wb") as out:
        await run_in_threadpool(shutil.copyfileobj, file.file, out)
    return path


def _remove(path: str):
    return lambda: os.path.exists(path) and os.remove(path)


@app.get("/api/health", dependencies=auth)
async def health() -> dict:
    reachable, error = await llm.ping()
    return {
        "status": "ok",
        "version": __version__,
        "stt": {"default": settings.default_stt_spec, "routes": settings.stt_routes, "loaded": router.loaded},
        "llm": {"reachable": reachable, "default_model": settings.ollama_model, "error": error},
        "diarization": settings.enable_diarization,
        "max_upload_mb": settings.max_upload_mb,
    }


@app.get("/api/models", dependencies=auth)
async def models() -> dict:
    try:
        names = await llm.list_models()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Ollama not reachable: {exc.__class__.__name__}") from exc
    return {"models": names, "default": settings.ollama_model}


@app.post("/api/transcribe", dependencies=auth)
async def transcribe_chunk(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    offset: float = Form(0.0),
    prompt: str = Form(""),
) -> dict:
    """Transcribe a short live chunk (5-10 s) synchronously."""
    mode = _check_mode(language)
    _check_size(file)
    try:
        audio = await run_in_threadpool(decode, file.file)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not decode audio: {exc}") from exc
    if audio.size < 1600:  # < 0.1 s
        return {"language": None, "language_probability": None, "engine": settings.default_stt_spec,
                "duration": audio.size / 16000, "segments": [], "text": ""}
    result = await run_in_threadpool(router.transcribe, audio, mode, prompt[-300:] or None)
    segments = [s.as_dict(offset) for s in result.segments]
    return {
        "language": result.language,
        "language_probability": result.language_probability,
        "engine": result.engine,
        "duration": audio.size / 16000,
        "segments": segments,
        "text": " ".join(s["text"] for s in segments),
    }


@app.post("/api/jobs/transcribe", dependencies=auth)
async def start_transcription(file: UploadFile = File(...), language: str = Form("auto")) -> dict:
    """Transcribe a full recording in the background (used for offline-queued recordings and re-transcription)."""
    mode = _check_mode(language)
    path = await _save_upload(file)
    job = store.create("transcribe")

    def work(job):
        audio = decode(path)
        result = router.transcribe_long(audio, mode, job.set_progress)
        segments = [s.as_dict() for s in result.segments]
        return {
            "language": result.language,
            "language_probability": None,
            "engine": result.engine,
            "duration": audio.size / 16000,
            "segments": segments,
            "text": " ".join(s["text"] for s in segments),
        }

    store.run_sync(job, work, cleanup=_remove(path))
    return {"id": job.id}


@app.post("/api/jobs/diarize", dependencies=auth)
async def start_diarization(
    file: UploadFile = File(...),
    segments: str = Form(...),
    num_speakers: Optional[int] = Form(None),
) -> dict:
    if not settings.enable_diarization:
        raise HTTPException(404, "Speaker labels are disabled on this server (ENABLE_DIARIZATION=false)")
    try:
        parsed = json.loads(segments)
        assert isinstance(parsed, list)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, "segments must be a JSON list") from exc
    path = await _save_upload(file)
    job = store.create("diarize")

    def work(job):
        from .diarize import assign_speakers, diarizer

        audio = decode(path)
        job.set_progress(0.1)
        turns = diarizer.turns(audio, num_speakers)
        labelled, speakers = assign_speakers(parsed, turns)
        return {"segments": labelled, "speakers": speakers}

    store.run_sync(job, work, cleanup=_remove(path))
    return {"id": job.id}


@app.post("/api/jobs/notes", dependencies=auth)
async def start_notes(req: llm.NotesRequest) -> dict:
    job = store.create("notes")

    async def work(job):
        notes, model = await llm.generate_notes(req, job.set_progress)
        return {"notes": notes.model_dump(), "model": model}

    store.run_async(job, work)
    return {"id": job.id}


@app.get("/api/jobs/{job_id}", dependencies=auth)
async def get_job(job_id: str) -> dict:
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found (the server may have restarted)")
    return job.public()


@app.delete("/api/jobs/{job_id}", dependencies=auth)
async def delete_job(job_id: str) -> dict:
    store.delete(job_id)
    return {"ok": True}
