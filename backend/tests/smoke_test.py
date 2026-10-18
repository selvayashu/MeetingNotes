"""Backend smoke test with a fake STT engine and a fake Ollama, so no models are needed.

    pip install -r backend/requirements-dev.txt
    python backend/tests/smoke_test.py
"""

import io
import os
import sys
import time
import wave
from pathlib import Path

os.environ["ACCESS_TOKEN"] = "secret"
os.environ["LLM_CHUNK_CHARS"] = "200"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import llm, main, stt  # noqa: E402
from app.diarize import assign_speakers  # noqa: E402

H = {"Authorization": "Bearer secret"}


class FakeEngine(stt.Engine):
    name = "fake"

    def detect_language(self, audio):
        return {"ta": 0.5, "ur": 0.9, "en": 0.3}

    def transcribe(self, audio, language, prompt):
        self.last = (language, prompt)
        return stt.Result(language, 0.9, self.name, [stt.Segment(0.0, len(audio) / 16000, f"hello-{language}")])


async def fake_chat(model, system, user):
    if "partial notes" in system:
        return {"summary": "merged", "key_points": ["a"], "decisions": [], "open_questions": [],
                "action_items": [{"owner": "Ravi", "task": "ship", "due_date": "2026-10-20"}]}
    return {"summary": "part", "key_points": ["x"], "decisions": [], "action_items": [], "open_questions": []}


def wait(client, job_id):
    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}", headers=H).json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.1)
    raise AssertionError("job did not finish")


def main_test():
    fake = FakeEngine()
    stt.router._engines[stt.settings.default_stt_spec] = fake
    main.decode = lambda f: np.random.default_rng(0).normal(0, 0.1, 16000 * 75).astype(np.float32)
    llm._chat = fake_chat
    c = TestClient(main.app)

    assert c.get("/api/health").status_code == 401, "auth not enforced"
    assert c.get("/api/health", headers=H).json()["status"] == "ok"

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(16000), w.writeframes(b"\0\0" * 16000)
    form = {"language": "auto", "offset": "10", "prompt": "earlier"}
    r = c.post("/api/transcribe", headers=H, files={"file": ("c.wav", buf.getvalue())}, data=form).json()
    assert r["language"] == "ta", "auto-detect must ignore languages outside AUTO_LANGUAGES"
    assert r["segments"][0]["start"] == 10.0 and fake.last == ("ta", "earlier")
    c.post("/api/transcribe", headers=H, files={"file": ("c.wav", buf.getvalue())}, data={"language": "ta-en"})
    assert "discuss பண்ணோம்" in fake.last[1], "ta-en mode must add the code-mixed prompt"
    assert c.post("/api/transcribe", headers=H, files={"file": ("c.wav", b"x")}, data={"language": "fr"}).status_code == 422
    print("chunk transcription ok")

    job = c.post("/api/jobs/transcribe", headers=H, files={"file": ("m.webm", b"x")}, data={"language": "ta"}).json()
    result = wait(c, job["id"])
    assert result["status"] == "done", result
    segments = result["result"]["segments"]
    assert len(segments) == 3 and abs(segments[-1]["end"] - 75) < 0.01, segments
    print("long transcription ok")

    job = c.post("/api/jobs/notes", headers=H, json={"transcript": "Sentence here. " * 40, "output_language": "en"}).json()
    result = wait(c, job["id"])
    assert result["status"] == "done" and result["result"]["notes"]["summary"] == "merged", result
    print("notes map-reduce ok")

    notes = llm._coerce({"summary": ["a", "b"], "key_points": "- x\n- y", "decisions": [{"what": "go"}],
                         "action_items": ["write doc", {"assignee": "Priya", "action": "test"}]})
    assert notes.summary == "a b" and notes.key_points == ["x", "y"] and notes.decisions == ["go"]
    assert [(a.owner, a.task) for a in notes.action_items] == [("", "write doc"), ("Priya", "test")]
    assert all(len(p) <= 200 for p in llm.split_transcript("word " * 500, 200))

    labelled, speakers = assign_speakers(
        [{"start": 0, "end": 4, "text": "a"}, {"start": 5, "end": 9, "text": "b"}], [(0, 4.5, "S1"), (4.5, 10, "S0")]
    )
    assert [s["speaker"] for s in labelled] == ["Speaker 1", "Speaker 2"] and speakers == ["Speaker 1", "Speaker 2"]
    print("ALL OK")


if __name__ == "__main__":
    main_test()
