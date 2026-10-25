# Workers AI findings (measured 2026-10-25)

Model: `@cf/openai/whisper-large-v3-turbo` — $0.000513 per audio minute.

## Input / output (confirmed)
- `audio`: **base64 string** of a complete audio file. 16 kHz mono WAV works.
- Useful options: `language` (omit for auto-detect), `vad_filter`, `condition_on_previous_text`, `initial_prompt`.
- Output: `text`, `segments[] {start,end,text,no_speech_prob,...}` (**seconds, relative to the clip**),
  `transcription_info {language, duration}`, `vtt`.
- Undecodable audio: `AiError 3030: Failed to decode audio file`.

## Size / time (measured with synthetic speech, WAV 16 kHz mono)
| clip | bytes | result |
|---|---|---|
| 30 s slice | 0.96 MB | 2.4 s |
| 2 min | 4 MB | 11.6 s |
| 5 min | 9.7 MB | 21 s |
| 15 min | 29 MB | 47 s |
| 30 min | 58 MB | Cloudflare error 1102 (Worker resource limit) in a bare test worker |

Roughly 3 s of inference per audio minute. The 1102 failure may come from the Worker's own
base64 work rather than Whisper, but it sets a practical ceiling, so MeetNotes keeps each
Whisper call small (parts of about 5 minutes and at most 12 MB; the server rejects parts over 16 MB).

## Not tested
- webm/opus, mp4/m4a and mp3 input (no ffmpeg or encoder available here). Browser recordings use
  webm (Chrome/Firefox/Android) or mp4 (iOS Safari); the first real recording is the test.
- Hindi and Tamil accuracy (no sample audio). Use the language hint for non-English meetings.

## Why audio is stored in parts
The server cannot cut webm/mp4 without ffmpeg. Recordings are therefore cut into self-contained
~5 minute segments by `useRecorder`, and uploaded WAV files are sliced client-side by `src/lib/wav.ts`.
Other uploaded formats go up as one part and must stay under 16 MB.

## Why processing is incremental
`/api/process-meeting` transcribes parts until a 35 s budget is used, saves progress
(`meetings.processed_parts`) and returns. The client calls again until `done`. This avoids
long-lived requests and `waitUntil` limits, and a retry resumes where it stopped. If the tab is
closed, processing pauses until the meeting is reopened and "Resume" is pressed.
