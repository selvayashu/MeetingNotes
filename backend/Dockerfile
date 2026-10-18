FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models/hf \
    MODEL_CACHE_DIR=/models

# Space-separated extras: "indic", "diarization", "gpu"
ARG INSTALL_EXTRAS=""

WORKDIR /srv
COPY requirements*.txt ./
RUN pip install -r requirements.txt \
    && for extra in $INSTALL_EXTRAS; do pip install -r "requirements-${extra}.txt"; done

COPY app ./app

RUN useradd --create-home --uid 1000 app && mkdir -p /models && chown app:app /models
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request,os; r=urllib.request.Request('http://127.0.0.1:8000/api/health', headers={'Authorization': 'Bearer '+os.getenv('ACCESS_TOKEN','')}); urllib.request.urlopen(r, timeout=8)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers"]
