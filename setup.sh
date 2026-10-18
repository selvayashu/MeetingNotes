#!/usr/bin/env bash
# One-command setup: builds the backend, starts Ollama, pulls the models and installs the frontend.
#   ./setup.sh            # local
#   ./setup.sh --https    # production with Caddy (set DOMAIN in .env first)
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/get-docker/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required."; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//'; }
MODEL="$(env_value OLLAMA_MODEL)"; MODEL="${MODEL:-qwen2.5:7b}"

PROFILE=()
if [ "${1:-}" = "--https" ]; then
  [ -n "$(env_value DOMAIN)" ] || { echo "Set DOMAIN in .env for --https"; exit 1; }
  PROFILE=(--profile https)
fi

echo "==> Building and starting containers"
docker compose "${PROFILE[@]}" up -d --build

echo "==> Pulling LLM: $MODEL (several GB, first time only)"
docker compose exec -T ollama ollama pull "$MODEL"

echo "==> Downloading speech models"
docker compose exec -T api python -m app.download

if command -v npm >/dev/null; then
  echo "==> Installing frontend dependencies"
  (cd frontend && npm ci)
else
  echo "Node.js not found; skipping frontend install (needed only to run/build the web app)."
fi

PORT="$(env_value API_PORT)"
echo
echo "Done. API: http://localhost:${PORT:-8000}/api/health"
echo "Start the app:  cd frontend && npm run dev   (then open http://localhost:5173)"
