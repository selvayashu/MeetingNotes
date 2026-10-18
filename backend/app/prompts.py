"""Prompt templates for meeting notes generation."""

from __future__ import annotations

from typing import Optional

LANGUAGE_LABELS = {
    "en": "English",
    "hi": "Hindi (Devanagari script)",
    "ta": "Tamil (Tamil script)",
}

STYLE_RULES = {
    "concise": "Be concise: a summary of 3-4 sentences, at most 7 key points, each one short line.",
    "detailed": "Be thorough: a summary of 5 sentences, up to 15 key points, each with enough context to be understood on its own.",
    "bullet": "Be extremely brief: a summary of 3 short sentences and terse key points of a few words each.",
}

FIELDS = """Return a JSON object with exactly these fields:
- "summary": a 3-5 sentence summary of the meeting (one string).
- "key_points": the main discussion points (list of strings).
- "decisions": decisions that were explicitly agreed (list of strings; empty if none).
- "action_items": list of objects {{"owner", "task", "due_date"}}. "owner" is the person responsible as named in the meeting, or "" if unclear. "due_date" is YYYY-MM-DD when it can be resolved from the meeting date ({meeting_date}); otherwise the phrase used (e.g. "end of sprint"), or "" if none was mentioned.
- "open_questions": unresolved questions or topics needing follow-up (list of strings; empty if none)."""


def output_language_rule(output_language: str, meeting_language: Optional[str]) -> str:
    if output_language in LANGUAGE_LABELS:
        return (
            f"Write ALL text values in {LANGUAGE_LABELS[output_language]}, translating from the transcript language "
            "where needed. Keep people's names, product names and technical terms as spoken."
        )
    spoken = LANGUAGE_LABELS.get(meeting_language or "", "the language the meeting was mainly held in")
    return (
        f"Write ALL text values in the same language as the meeting ({spoken}). If speakers mix that language with "
        "English, write in the main language's script and keep English technical terms in English, as the speakers did."
    )


def system_prompt(output_language: str, meeting_language: Optional[str], style: str, meeting_date: str,
                  part: Optional[tuple[int, int]] = None) -> str:
    scope = ""
    if part:
        scope = (
            f"\nThis is part {part[0]} of {part[1]} of a long meeting. Extract notes for this part only; "
            "the parts will be merged later."
        )
    return f"""You are an expert meeting assistant who turns raw transcripts into accurate, well-structured notes.
The transcript comes from automatic speech recognition. It may contain recognition errors, missing punctuation and code-switching between Indian languages (Tamil, Hindi) and English. Infer the intended meaning, but never invent facts, names, numbers or dates that the transcript does not support.{scope}

{output_language_rule(output_language, meeting_language)}
{STYLE_RULES.get(style, STYLE_RULES["concise"])}

{FIELDS.format(meeting_date=meeting_date)}"""


def merge_prompt(output_language: str, meeting_language: Optional[str], style: str, meeting_date: str) -> str:
    return f"""You are an expert meeting assistant. You are given partial notes (JSON) extracted from consecutive parts of ONE meeting.
Merge them into a single set of notes: remove duplicates, combine related points, keep every distinct decision and action item, and write one overall summary of the whole meeting.

{output_language_rule(output_language, meeting_language)}
{STYLE_RULES.get(style, STYLE_RULES["concise"])}

{FIELDS.format(meeting_date=meeting_date)}"""


def user_prompt(transcript: str, title: Optional[str], meeting_date: str, manual_notes: Optional[str]) -> str:
    parts = []
    if title:
        parts.append(f"Meeting title: {title}")
    parts.append(f"Meeting date: {meeting_date}")
    if manual_notes and manual_notes.strip():
        parts.append(f"Notes typed by the user during the meeting (reliable context):\n{manual_notes.strip()}")
    parts.append(f"Transcript:\n<<<\n{transcript}\n>>>")
    return "\n\n".join(parts)
