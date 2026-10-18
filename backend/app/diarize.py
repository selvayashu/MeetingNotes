"""Optional speaker labels with pyannote.audio (enable with ENABLE_DIARIZATION=true).

pyannote/speaker-diarization-3.1 is open source (MIT) but gated: accept its terms on Hugging Face
once and put a free read token in HF_TOKEN so the weights can be downloaded.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

import numpy as np

from .config import settings

log = logging.getLogger("meetnotes.diarize")


class Diarizer:
    def __init__(self) -> None:
        self._pipeline = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._pipeline is None:
                import torch
                from pyannote.audio import Pipeline

                log.info("Loading %s", settings.diarization_model)
                pipeline = Pipeline.from_pretrained(settings.diarization_model, use_auth_token=settings.hf_token or None)
                if pipeline is None:
                    raise RuntimeError(
                        f"Could not load {settings.diarization_model}. Accept its conditions on huggingface.co "
                        "and set HF_TOKEN in .env."
                    )
                if torch.cuda.is_available():
                    pipeline.to(torch.device("cuda"))
                self._pipeline = pipeline
            return self._pipeline

    def turns(self, audio: np.ndarray, num_speakers: Optional[int] = None) -> list[tuple[float, float, str]]:
        import torch

        pipeline = self._load()
        waveform = torch.from_numpy(np.ascontiguousarray(audio)).unsqueeze(0)
        kwargs = {"num_speakers": num_speakers} if num_speakers else {}
        annotation = pipeline({"waveform": waveform, "sample_rate": 16000}, **kwargs)
        return [(turn.start, turn.end, label) for turn, _, label in annotation.itertracks(yield_label=True)]


def assign_speakers(segments: list[dict], turns: list[tuple[float, float, str]]) -> tuple[list[dict], list[str]]:
    """Label each transcript segment with the speaker who overlaps it most ("Speaker 1", ...)."""
    names: dict[str, str] = {}
    for _, _, label in sorted(turns):
        names.setdefault(label, f"Speaker {len(names) + 1}")
    labelled = []
    for seg in segments:
        start, end = float(seg["start"]), float(seg["end"])
        overlap: dict[str, float] = {}
        for t_start, t_end, label in turns:
            amount = min(end, t_end) - max(start, t_start)
            if amount > 0:
                overlap[label] = overlap.get(label, 0.0) + amount
        if overlap:
            label = max(overlap, key=overlap.get)
        elif turns:
            mid = (start + end) / 2
            label = min(turns, key=lambda t: min(abs(mid - t[0]), abs(mid - t[1])))[2]
        else:
            label = None
        labelled.append({**seg, "speaker": names.get(label)} if label else dict(seg))
    return labelled, list(names.values())


diarizer = Diarizer()
