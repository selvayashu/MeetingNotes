# MeetNotes

**MeetNotes is a private AI meeting notes app for English, Hindi and Tamil (including Tamil–English and Hindi–English code-switching).**
It records a meeting, shows a live transcript while you talk, and then writes a summary, key points,
decisions, action items and open questions. Everything runs on open-source models on **your own
server** (or in the browser). There are no paid APIs and no API keys.

- **Installable PWA** on Android, iOS and desktop, with offline support and dark mode. The UI is in English, हिन्दी and தமிழ்.
- **Speech-to-text:** [faster-whisper](https://github.com/SYSTRAN/faster-whisper), with per-language routing to
  [IndicWhisper](https://github.com/AI4Bharat/vistaar) checkpoints or
  [AI4Bharat IndicConformer](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual).
- **Notes:** [Ollama](https://ollama.com), default `qwen2.5:7b` (configurable).
- **Speaker labels (optional):** [pyannote.audio](https://github.com/pyannote/pyannote-audio).
- **Offline fallback:** Whisper runs in the browser with [transformers.js](https://huggingface.co/docs/transformers.js) (WebGPU/WASM).

```
┌──────────── Browser / installed PWA ────────────┐        ┌──────────── Your server (Docker) ─────────────┐
│ MediaRecorder ─► full recording (IndexedDB)     │        │  FastAPI  /api/transcribe   (live chunks)     │
│ AudioWorklet ─► 16 kHz PCM ─► 5–10 s WAV chunks ├─HTTPS─►│           /api/jobs/*       (full file, notes,│
│ Dexie: meetings, audio, notes   (local-first)   │        │                              speakers)        │
│ Workbox SW: app shell offline, sync wake-up     │        │  faster-whisper / IndicWhisper / IndicConformer│
│ transformers.js Whisper (offline fallback)      │        │  pyannote.audio (optional)                    │
└─────────────────────────────────────────────────┘        │  Ollama ─ qwen2.5 (or any model)              │
                                                           └───────────────────────────────────────────────┘
```

## Contents

1. [Features](#features)
2. [Quick start](#quick-start)
3. [Running the app](#running-the-app)
4. [Configuration](#configuration)
5. [Tamil, Hindi and code-switching](#tamil-hindi-and-code-switching)
6. [Testing transcription quality](#testing-transcription-quality)
7. [Privacy](#privacy)
8. [PWA and offline behaviour](#pwa-and-offline-behaviour)
9. [Deployment](docs/DEPLOYMENT.md) · [Lighthouse / installability checklist](docs/LIGHTHOUSE.md)
10. [Project structure](#project-structure)
11. [Troubleshooting](#troubleshooting)

## Features

| Area | What you get |
|---|---|
| Record | Record / pause / stop, live timer, live waveform, screen wake-lock, crash-safe (audio is saved every 5 s) |
| Live transcript | Audio is cut into 5–10 s chunks at natural pauses and transcribed as you speak. Language: English / Hindi / Tamil / Auto-detect / Tamil+English / Hindi+English |
| AI notes | Summary (3–5 sentences), key points, decisions, action items (owner, task, due date) and open questions, written in the meeting's language or one you choose (e.g. Tamil speech → English notes). Concise, detailed or brief styles. Long meetings are summarised in parts, then merged |
| Library | Search across titles, transcripts, notes and tags, plus a tag filter and a date range. Title, tags, transcript, notes and action items are all editable |
| Notes & bookmarks | Type your own notes and add timestamped bookmarks while recording. Click any timestamp to jump the audio player there |
| Export | Copy, Markdown, **PDF with correct Tamil and Devanagari** (bundled Noto fonts), Print / Save as PDF, Web Share API |
| Speakers | Optional pyannote speaker labels, behind a server flag and a setting |
| Offline | The app shell works offline. Recordings made offline are queued and processed automatically when you're back online, or transcribed in the browser |

## Quick start

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) (with Compose v2), [Node.js 20+](https://nodejs.org) and Git.
16 GB of RAM is recommended. A GPU is optional: on CPU, use Whisper `small`/`base` (int8) and a 3B LLM.

```bash
git clone https://github.com/selvayashu/MeetingNotes.git
cd MeetingNotes
./setup.sh            # Windows PowerShell: .\setup.ps1
```

`setup.sh` creates `.env` from `.env.example`, builds and starts the containers, pulls the Ollama
model (~4.7 GB for `qwen2.5:7b`), downloads the Whisper model and installs the frontend.

Then run the web app:

```bash
cd frontend
npm run dev           # http://localhost:5173
```

Open **Settings → Test connection**. It should say *Connected*. Then press **Start recording**.

> **Low-RAM / CPU-only machine (8 GB):** set `OLLAMA_MODEL=qwen2.5:3b` and `WHISPER_MODEL=base` in `.env`
> before running setup. You can switch back at any time (`docker compose exec ollama ollama pull qwen2.5:7b`).

## Running the app

| Task | Command |
|---|---|
| Start / stop the backend | `docker compose up -d` / `docker compose down` |
| Backend logs | `docker compose logs -f api` |
| Pull another LLM | `docker compose exec ollama ollama pull qwen2.5:3b` |
| Frontend dev server | `cd frontend && npm run dev` |
| Production build | `cd frontend && npm run build` (output in `frontend/dist`) |
| Preview the production build (service worker active) | `cd frontend && npm run preview` |
| Backend smoke test (no models needed) | `pip install -r backend/requirements-dev.txt && python backend/tests/smoke_test.py` |
| Backend without Docker | `cd backend && pip install -r requirements.txt && OLLAMA_URL=http://localhost:11434 uvicorn app.main:app --reload` |

**Using a phone on your LAN during development.** Browsers allow the microphone only on HTTPS or
`localhost`, so a phone opening `http://192.168.x.x:5173` can't record. Either deploy with HTTPS
([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)) or use a tunnel such as `cloudflared tunnel --url http://localhost:5173`.
Set `API_BIND=0.0.0.0` in `.env` to make the API reachable from other devices.

## Configuration

Backend settings live in `.env` (see [.env.example](.env.example) for every option). The main ones:

| Variable | Default | Notes |
|---|---|---|
| `WHISPER_MODEL` | `small` | `tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo` (GPU) |
| `WHISPER_DEVICE` / `WHISPER_COMPUTE_TYPE` | `auto` | int8 on CPU, float16 on GPU |
| `AUTO_LANGUAGES` | `en,hi,ta` | Languages Auto-detect may choose. Stops Hindi being labelled as Urdu |
| `STT_ROUTES` | *(empty)* | Per-language engine, e.g. `ta=hf:vasista22/whisper-tamil-medium;hi=indicconformer:ai4bharat/indic-conformer-600m-multilingual` |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Any Ollama model; users can override it per device in Settings |
| `OLLAMA_NUM_CTX` | `8192` | Context window for notes |
| `ENABLE_DIARIZATION` | `false` | Speaker labels. Needs `INSTALL_EXTRAS=diarization` and `HF_TOKEN` |
| `INSTALL_EXTRAS` | *(empty)* | Docker build extras: `indic`, `diarization`, `gpu` |
| `ACCESS_TOKEN` | *(empty)* | A shared password for your server. Enter the same value in the app's Settings |
| `CORS_ORIGINS` | `*` | Set this to your frontend URL in production |

Settings in the app (stored per device): server URL and token, where to transcribe (server / browser /
server with browser fallback), default spoken language, notes language, summary style, LLM model, UI
language, theme, chunk length, auto-notes, delete audio after transcription, speaker labels, and the
consent notice.

### Swapping in IndicWhisper or IndicConformer

1. In `.env`, set `INSTALL_EXTRAS=indic` and, for example:
   ```
   STT_ROUTES=ta=hf:vasista22/whisper-tamil-medium;hi=indicconformer:ai4bharat/indic-conformer-600m-multilingual
   ```
2. Rebuild and download the models: `docker compose up -d --build && docker compose exec api python -m app.download`.

`hf:<model>` accepts any Whisper checkpoint on the Hugging Face Hub (AI4Bharat's IndicWhisper /
Vistaar models, `vasista22/whisper-hindi-*`, `vasista22/whisper-tamil-*`, …).
`indicconformer:<model>` uses AI4Bharat's IndicConformer (CTC by default, `INDICCONFORMER_DECODER=rnnt` for RNNT).
Routing uses the language chosen in the app, or the language detected for each 30 s window, so in
Auto mode Tamil parts go to the Tamil model and English parts to Whisper. Check the licence on each
model card. Some models are gated and need a free `HF_TOKEN`.

### Speaker labels

1. Accept the conditions for [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
   and [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0) on Hugging Face (free).
2. Create a read token and set `HF_TOKEN=…`, `ENABLE_DIARIZATION=true` and `INSTALL_EXTRAS=diarization` in `.env`.
3. Rebuild with `docker compose up -d --build`, then turn on **Settings → Speaker labels** in the app.

On CPU, diarization takes roughly 1–3 minutes per 10 minutes of audio.

## Tamil, Hindi and code-switching

Indian meetings often mix languages ("இன்னைக்கு meeting-ல deadline பத்தி discuss பண்ணோம்"). MeetNotes handles this in four ways:

- **Mixed modes (Tamil + English, Hindi + English).** Language detection is limited to the pair, and Whisper is
  given a code-mixed example prompt, so English words stay in Latin script instead of being
  transliterated (for example, "deadline" rather than "டெட்லைன்").
- **Detection per chunk or window.** Each live chunk and each 30 s window of a full file is detected
  separately, so meetings that switch languages are transcribed in the right language throughout.
- **Context carry-over.** The last few transcribed words are passed as context to the next chunk.
- **Notes prompt.** The LLM is told the transcript may be code-mixed, keeps technical terms as spoken, and writes in the
  chosen output language and script.

Accuracy guidance: Whisper `small` is usable for Hindi and weaker for Tamil. Whisper `medium`/`large-v3`
or a Tamil IndicWhisper route clearly improves Tamil. Measure with the test script below before choosing.

## Testing transcription quality

```bash
cp tests/samples/manifest.example.csv tests/samples/manifest.csv   # then add your audio + references
python scripts/test_transcription.py --manifest tests/samples/manifest.csv --show --max-cer 0.35
```

The script reports WER, CER (the better metric for Tamil and Hindi), the Latin-script share for
code-mixed clips, and the real-time factor, per file and per language mode. It uses only the Python
standard library. See [tests/samples/README.md](tests/samples/README.md) for free sample sources.

## Privacy

- A **consent notice** is shown before recording. It can be turned off per device and turned back on in Settings.
- **Local-first:** meetings, audio and notes live in the browser's IndexedDB on the device. The app asks the
  browser for persistent storage.
- **Audio and transcripts go only to the server URL you configure** (your own server), or nowhere at all
  in browser-only mode. There's no analytics and no third-party API. The only other downloads are open
  model weights for browser mode (Hugging Face) and the ONNX runtime (bundled, with a CDN fallback).
- **Delete** a single meeting, just its audio, or everything. The option *Delete audio after transcription*
  removes recordings automatically.
- The server keeps uploads only in temporary files while processing and deletes them afterwards.
  Job results stay in memory for at most `JOB_TTL_SECONDS` (default 1 hour).
- Protect a public server with `ACCESS_TOKEN` and `CORS_ORIGINS`.

## PWA and offline behaviour

- `manifest.json`: name, 192/512 icons (`any` + `maskable`), theme colour, `display: standalone`, and a shortcut to start a recording.
- Service worker (Workbox, `src/sw.ts`): precaches the app shell, fonts and icons, works offline for every
  route, and runtime-caches the in-browser speech runtime.
- **Offline recording:** you can record without a connection. Live transcription switches to the in-browser
  model (in *server with browser fallback* mode) or waits. On stop, the meeting is queued. When the device is
  back online (detected through the `online` event, Background Sync where supported, and a periodic
  check), queued meetings are transcribed and summarised automatically.
- **Install prompt:** a custom *Install* button on Android/desktop Chrome/Edge, and *Share → Add to Home
  Screen* instructions on iOS.
- **Updates:** a "New version available, Update" bar appears when a new build is deployed.
- **Microphone problems** (denied, missing, busy, insecure origin, unsupported browser) each show a
  specific explanation, with per-platform steps to fix them.

## Project structure

```
├── backend/                  FastAPI service
│   ├── app/main.py           API routes (health, models, transcribe, jobs)
│   ├── app/stt.py            Engines (faster-whisper / HF Whisper / IndicConformer), routing, code-switching
│   ├── app/llm.py            Ollama notes generation (JSON schema, map-reduce for long meetings)
│   ├── app/prompts.py        Notes prompts (languages, styles)
│   ├── app/diarize.py        Optional pyannote speaker labels
│   ├── app/jobs.py           In-memory background jobs with progress
│   ├── Dockerfile, requirements*.txt
├── frontend/                 React + Vite + TypeScript PWA
│   ├── src/pages/            Home, Recording, Library, MeetingDetail, Settings
│   ├── src/lib/              recorder, api, pipeline (offline queue), db (Dexie), export, pdf, browserStt
│   ├── src/workers/          transformers.js Whisper worker
│   ├── src/locales/          en / hi / ta UI strings
│   ├── src/sw.ts             Service worker (Workbox)
│   └── public/               icons, worklet, _headers
├── deploy/Caddyfile          Automatic HTTPS reverse proxy
├── docker-compose.yml        api + ollama (+ caddy with --profile https)
├── docker-compose.gpu.yml    NVIDIA override
├── setup.sh / setup.ps1      One-command setup
├── scripts/test_transcription.py   Quality test (WER/CER, code-mixing)
├── scripts/generate_icons.py       Regenerates the PWA icons
└── docs/                     Deployment and Lighthouse/PWA checklist
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| *Can't reach the server* | Check `docker compose ps`, the server URL in Settings, and `CORS_ORIGINS`. An HTTPS app can't call an `http://` API (mixed content), so give the API HTTPS too |
| *Access token is missing or wrong* | The token in Settings must equal `ACCESS_TOKEN` in `.env` |
| Notes fail with "model not installed" | `docker compose exec ollama ollama pull <model>` |
| Notes are slow | On CPU, a 7B model needs 1–3 min for a 30 min meeting. Use `qwen2.5:3b`, or add a GPU |
| Hindi shows up as Urdu script | Keep `AUTO_LANGUAGES=en,hi,ta`, or choose Hindi / Hindi + English explicitly |
| English words come out in Tamil script | Use the Tamil + English mode |
| No microphone on a phone | The page must be served over HTTPS (see above) |
| iOS stops recording when the screen locks | iOS suspends web apps in the background. Keep MeetNotes in the foreground (it holds a wake-lock) |

## Licence

MIT for this code. The models you download have their own licences (Whisper: MIT; Qwen 2.5: Apache-2.0
for most sizes, check the model card; IndicConformer/IndicWhisper and pyannote: see their model cards).
