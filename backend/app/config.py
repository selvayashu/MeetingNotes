"""Runtime configuration, read once from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _str(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return default if value is None or value.strip() == "" else value.strip()


def _int(name: str, default: int) -> int:
    return int(_str(name, str(default)))


def _float(name: str, default: float) -> float:
    return float(_str(name, str(default)))


def _bool(name: str, default: bool = False) -> bool:
    return _str(name, "true" if default else "false").lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in _str(name, default).split(",") if item.strip()]


def _routes(raw: str) -> dict[str, str]:
    """Parse STT_ROUTES, e.g. "ta=hf:vasista22/whisper-tamil-medium;hi=indicconformer:ai4bharat/indic-conformer-600m-multilingual"."""
    routes: dict[str, str] = {}
    for part in raw.split(";"):
        part = part.strip()
        if not part:
            continue
        lang, sep, spec = part.partition("=")
        if not sep or not spec.strip():
            raise ValueError(f"Invalid STT_ROUTES entry {part!r}; expected <lang>=<engine>:<model>")
        routes[lang.strip().lower()] = spec.strip()
    return routes


@dataclass(frozen=True)
class Settings:
    # Speech-to-text
    whisper_model: str = field(default_factory=lambda: _str("WHISPER_MODEL", "small"))
    whisper_device: str = field(default_factory=lambda: _str("WHISPER_DEVICE", "auto"))
    whisper_compute_type: str = field(default_factory=lambda: _str("WHISPER_COMPUTE_TYPE", "auto"))
    whisper_beam_size: int = field(default_factory=lambda: _int("WHISPER_BEAM_SIZE", 5))
    whisper_cpu_threads: int = field(default_factory=lambda: _int("WHISPER_CPU_THREADS", 0))
    whisper_vad: bool = field(default_factory=lambda: _bool("WHISPER_VAD", True))
    stt_routes: dict[str, str] = field(default_factory=lambda: _routes(_str("STT_ROUTES")))
    # Languages "auto" may pick. Whisper often mislabels Hindi as Urdu; restricting fixes that. Empty = any.
    auto_languages: list[str] = field(default_factory=lambda: _list("AUTO_LANGUAGES", "en,hi,ta"))
    indicconformer_decoder: str = field(default_factory=lambda: _str("INDICCONFORMER_DECODER", "ctc"))
    model_cache_dir: str = field(default_factory=lambda: _str("MODEL_CACHE_DIR", "/models"))

    # LLM (Ollama)
    ollama_url: str = field(default_factory=lambda: _str("OLLAMA_URL", "http://localhost:11434").rstrip("/"))
    ollama_model: str = field(default_factory=lambda: _str("OLLAMA_MODEL", "qwen2.5:7b"))
    ollama_num_ctx: int = field(default_factory=lambda: _int("OLLAMA_NUM_CTX", 8192))
    ollama_timeout: float = field(default_factory=lambda: _float("OLLAMA_TIMEOUT", 900))
    ollama_keep_alive: str = field(default_factory=lambda: _str("OLLAMA_KEEP_ALIVE", "30m"))
    llm_temperature: float = field(default_factory=lambda: _float("LLM_TEMPERATURE", 0.2))
    llm_chunk_chars: int = field(default_factory=lambda: _int("LLM_CHUNK_CHARS", 6000))

    # Speaker labels (pyannote.audio), off by default
    enable_diarization: bool = field(default_factory=lambda: _bool("ENABLE_DIARIZATION", False))
    diarization_model: str = field(default_factory=lambda: _str("DIARIZATION_MODEL", "pyannote/speaker-diarization-3.1"))
    hf_token: str = field(default_factory=lambda: _str("HF_TOKEN"))

    # Server
    access_token: str = field(default_factory=lambda: _str("ACCESS_TOKEN"))
    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS", "*"))
    max_upload_mb: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 300))
    job_workers: int = field(default_factory=lambda: _int("JOB_WORKERS", 1))
    job_ttl_seconds: int = field(default_factory=lambda: _int("JOB_TTL_SECONDS", 3600))

    @property
    def default_stt_spec(self) -> str:
        return f"faster-whisper:{self.whisper_model}"


settings = Settings()
