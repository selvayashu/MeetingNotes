"""Speech-to-text engines and language routing.

Engines are addressed by a spec string "<kind>:<model>":
  faster-whisper:small                                   (default, CTranslate2 Whisper)
  hf:vasista22/whisper-tamil-medium                      (any Hugging Face Whisper checkpoint, e.g. IndicWhisper)
  indicconformer:ai4bharat/indic-conformer-600m-multilingual

STT_ROUTES maps a language to an engine; anything not routed uses faster-whisper.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

from .config import settings

log = logging.getLogger("meetnotes.stt")

SAMPLE_RATE = 16000
FIXED_LANGUAGES = {"en", "hi", "ta"}
WHISPER_LANGUAGE_NAMES = {"en": "english", "hi": "hindi", "ta": "tamil"}

# Code-switching modes: restrict language detection to the pair and prime the decoder with a
# code-mixed sentence so English words stay in Latin script instead of being transliterated.
MIXED_MODES: dict[str, tuple[tuple[str, ...], str]] = {
    "ta-en": (
        ("ta", "en"),
        "இன்னைக்கு meeting-ல நம்ம project deadline பத்தி discuss பண்ணோம், next week release பண்ணலாம்.",
    ),
    "hi-en": (
        ("hi", "en"),
        "आज की meeting में हमने project deadline के बारे में discuss किया, next week release करेंगे।",
    ),
}
VALID_MODES = FIXED_LANGUAGES | set(MIXED_MODES) | {"auto"}

ProgressFn = Callable[[float], None]


@dataclass
class Segment:
    start: float
    end: float
    text: str
    lang: Optional[str] = None

    def as_dict(self, offset: float = 0.0) -> dict:
        data = {"start": round(self.start + offset, 2), "end": round(self.end + offset, 2), "text": self.text}
        if self.lang:
            data["lang"] = self.lang
        return data


@dataclass
class Result:
    language: Optional[str]
    language_probability: Optional[float]
    engine: str
    segments: list[Segment] = field(default_factory=list)


class Engine:
    name = "engine"
    can_detect_language = False

    def detect_language(self, audio: np.ndarray) -> dict[str, float]:
        return {}

    def transcribe(self, audio: np.ndarray, language: Optional[str], prompt: Optional[str]) -> Result:
        raise NotImplementedError


class FasterWhisperEngine(Engine):
    can_detect_language = True

    def __init__(self, model_name: str):
        from faster_whisper import WhisperModel

        device = settings.whisper_device
        if device == "auto":
            device = "cuda" if _cuda_available() else "cpu"
        compute_type = settings.whisper_compute_type
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"
        log.info("Loading faster-whisper %s on %s (%s)", model_name, device, compute_type)
        self.model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            cpu_threads=settings.whisper_cpu_threads,
            download_root=f"{settings.model_cache_dir}/whisper",
        )
        self.name = f"faster-whisper:{model_name}"

    def detect_language(self, audio: np.ndarray) -> dict[str, float]:
        _, _, all_probs = self.model.detect_language(audio)
        return dict(all_probs)

    def transcribe(self, audio: np.ndarray, language: Optional[str], prompt: Optional[str]) -> Result:
        segments, info = self.model.transcribe(
            audio,
            language=language,
            task="transcribe",
            beam_size=settings.whisper_beam_size,
            vad_filter=settings.whisper_vad,
            initial_prompt=prompt or None,
            condition_on_previous_text=False,
        )
        out: list[Segment] = []
        for seg in segments:
            text = seg.text.strip()
            # Drop typical Whisper hallucinations on silence/noise.
            if not text or (seg.no_speech_prob > 0.6 and seg.avg_logprob < -1.0):
                continue
            out.append(Segment(seg.start, seg.end, text))
        return Result(info.language, info.language_probability, self.name, out)


class HFWhisperEngine(Engine):
    """Any Whisper checkpoint on the Hugging Face Hub (e.g. IndicWhisper fine-tunes)."""

    def __init__(self, model_id: str):
        import torch
        from transformers import pipeline

        use_cuda = torch.cuda.is_available()
        log.info("Loading HF Whisper %s (cuda=%s)", model_id, use_cuda)
        self.pipe = pipeline(
            "automatic-speech-recognition",
            model=model_id,
            device=0 if use_cuda else -1,
            torch_dtype=torch.float16 if use_cuda else torch.float32,
            token=settings.hf_token or None,
            model_kwargs={"cache_dir": f"{settings.model_cache_dir}/hf"},
        )
        self.name = f"hf:{model_id}"

    def transcribe(self, audio: np.ndarray, language: Optional[str], prompt: Optional[str]) -> Result:
        generate_kwargs = {"task": "transcribe"}
        if language in WHISPER_LANGUAGE_NAMES:
            generate_kwargs["language"] = WHISPER_LANGUAGE_NAMES[language]
        call = dict(chunk_length_s=30, batch_size=4, return_timestamps=True)
        sample = {"raw": audio, "sampling_rate": SAMPLE_RATE}
        try:
            out = self.pipe(sample, generate_kwargs=generate_kwargs, **call)
        except (ValueError, KeyError):
            # Some single-language fine-tunes have no language tokens configured.
            out = self.pipe(sample, **call)
        segments: list[Segment] = []
        duration = len(audio) / SAMPLE_RATE
        for chunk in out.get("chunks") or []:
            text = (chunk.get("text") or "").strip()
            start, end = chunk.get("timestamp") or (None, None)
            if text:
                segments.append(Segment(start or 0.0, end if end is not None else duration, text))
        if not segments and (out.get("text") or "").strip():
            segments.append(Segment(0.0, duration, out["text"].strip()))
        return Result(language, None, self.name, segments)


class IndicConformerEngine(Engine):
    """AI4Bharat IndicConformer (CTC/RNNT). Needs an explicit language; works on ~20 s windows."""

    WINDOW_SECONDS = 20

    def __init__(self, model_id: str):
        import torch
        from transformers import AutoModel

        log.info("Loading IndicConformer %s", model_id)
        self.torch = torch
        self.model = AutoModel.from_pretrained(
            model_id,
            trust_remote_code=True,
            token=settings.hf_token or None,
            cache_dir=f"{settings.model_cache_dir}/hf",
        )
        self.name = f"indicconformer:{model_id}"

    def transcribe(self, audio: np.ndarray, language: Optional[str], prompt: Optional[str]) -> Result:
        if not language:
            raise ValueError("IndicConformer needs an explicit language; route it per language in STT_ROUTES")
        segments: list[Segment] = []
        step = self.WINDOW_SECONDS * SAMPLE_RATE
        for start in range(0, len(audio), step):
            piece = audio[start : start + step]
            if len(piece) < SAMPLE_RATE // 4:
                continue
            wav = self.torch.from_numpy(np.ascontiguousarray(piece)).unsqueeze(0)
            with self.torch.inference_mode():
                text = self.model(wav, language, settings.indicconformer_decoder)
            if isinstance(text, (list, tuple)):
                text = text[0] if text else ""
            text = str(text).strip()
            if text:
                segments.append(Segment(start / SAMPLE_RATE, (start + len(piece)) / SAMPLE_RATE, text))
        return Result(language, None, self.name, segments)


ENGINE_KINDS = {
    "faster-whisper": FasterWhisperEngine,
    "hf": HFWhisperEngine,
    "indicconformer": IndicConformerEngine,
}


def _cuda_available() -> bool:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def _quietest_cut(audio: np.ndarray, lo: int, hi: int) -> int:
    """Index of the quietest 100 ms frame between lo and hi (to avoid cutting words)."""
    frame = SAMPLE_RATE // 10
    best, best_energy = hi, float("inf")
    for pos in range(lo, max(lo, hi - frame) + 1, frame // 2):
        energy = float(np.mean(audio[pos : pos + frame] ** 2))
        if energy < best_energy:
            best, best_energy = pos + frame // 2, energy
    return best


class STTRouter:
    def __init__(self) -> None:
        self._engines: dict[str, Engine] = {}
        self._load_lock = threading.Lock()
        self._run_lock = threading.Lock()  # models are large; run one transcription at a time

    @property
    def loaded(self) -> list[str]:
        return list(self._engines)

    def get(self, spec: str) -> Engine:
        with self._load_lock:
            if spec not in self._engines:
                kind, _, model = spec.partition(":")
                if kind not in ENGINE_KINDS or not model:
                    raise ValueError(f"Unknown STT engine spec {spec!r}; use one of {sorted(ENGINE_KINDS)}:<model>")
                self._engines[spec] = ENGINE_KINDS[kind](model)
            return self._engines[spec]

    def engine_for(self, language: Optional[str]) -> Engine:
        spec = settings.stt_routes.get(language or "") or settings.default_stt_spec
        return self.get(spec)

    def _detect(self, audio: np.ndarray, candidates: tuple[str, ...] | list[str] | None) -> tuple[Optional[str], Optional[float]]:
        detector = self.get(settings.default_stt_spec)
        try:
            probs = detector.detect_language(audio)
        except Exception:  # very short or silent audio
            log.debug("language detection failed", exc_info=True)
            return (candidates[0] if candidates else None), None
        if candidates:
            probs = {lang: probs.get(lang, 0.0) for lang in candidates}
        if not probs:
            return None, None
        lang = max(probs, key=probs.get)
        return lang, probs[lang]

    def _transcribe_window(self, audio: np.ndarray, mode: str, context: Optional[str]) -> Result:
        mix_prompt = None
        prob = None
        if mode in FIXED_LANGUAGES:
            lang: Optional[str] = mode
        elif mode in MIXED_MODES:
            candidates, mix_prompt = MIXED_MODES[mode]
            lang, prob = self._detect(audio, candidates)
        else:
            lang, prob = self._detect(audio, settings.auto_languages or None)
        prompt_parts = [p for p in (mix_prompt if lang != "en" else None, context) if p]
        result = self.engine_for(lang).transcribe(audio, lang, " ".join(prompt_parts) or None)
        result.language = result.language or lang
        if result.language_probability is None:
            result.language_probability = prob
        for seg in result.segments:
            seg.lang = result.language
        return result

    def transcribe(self, audio: np.ndarray, mode: str, prompt: Optional[str] = None) -> Result:
        """Transcribe a short live chunk (a few seconds)."""
        with self._run_lock:
            return self._transcribe_window(audio, mode, prompt)

    def transcribe_long(self, audio: np.ndarray, mode: str, progress: Optional[ProgressFn] = None) -> Result:
        """Transcribe a full recording in ~30 s windows, detecting language per window so
        code-switched meetings are handled, and reporting progress."""
        window, total = 30 * SAMPLE_RATE, len(audio)
        segments: list[Segment] = []
        lang_time: dict[str, float] = {}
        engine_name = ""
        pos = 0
        with self._run_lock:
            while pos < total:
                end = total if total - pos <= window + 5 * SAMPLE_RATE else _quietest_cut(audio, pos + 25 * SAMPLE_RATE, pos + window)
                piece = audio[pos:end]
                if len(piece) >= SAMPLE_RATE // 2:
                    context = " ".join(s.text for s in segments[-3:])[-200:] or None
                    result = self._transcribe_window(piece, mode, context)
                    engine_name = result.engine
                    offset = pos / SAMPLE_RATE
                    for seg in result.segments:
                        segments.append(Segment(seg.start + offset, seg.end + offset, seg.text, seg.lang))
                    if result.language:
                        lang_time[result.language] = lang_time.get(result.language, 0.0) + len(piece) / SAMPLE_RATE
                pos = end
                if progress:
                    progress(pos / total)
        language = max(lang_time, key=lang_time.get) if lang_time else None
        return Result(language, None, engine_name or settings.default_stt_spec, segments)


def decode(file) -> np.ndarray:
    """Decode any audio container (webm/ogg/mp4/wav/mp3) to 16 kHz mono float32 via PyAV."""
    from faster_whisper import decode_audio

    return decode_audio(file, sampling_rate=SAMPLE_RATE)


router = STTRouter()
