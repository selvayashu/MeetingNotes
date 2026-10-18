"""Pre-download every configured model so the first request is fast: python -m app.download"""

import logging

from .config import settings
from .stt import router

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("meetnotes.download")


def main() -> None:
    for spec in {settings.default_stt_spec, *settings.stt_routes.values()}:
        log.info("Fetching STT model %s", spec)
        router.get(spec)
    if settings.enable_diarization:
        from .diarize import diarizer

        log.info("Fetching diarization model %s", settings.diarization_model)
        diarizer._load()
    log.info("All models ready.")


if __name__ == "__main__":
    main()
