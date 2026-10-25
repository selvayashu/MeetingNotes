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

# Notes LLM (measured 2026-10-25)

Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (24k context, $0.293/M input, $2.253/M output).
Override with the `LLM_MODEL` variable.

## Why not GLM / Qwen3
`@cf/zai-org/glm-4.7-flash` and `@cf/qwen/qwen3-30b-a3b-fp8` are *reasoning* models. In tests they
sometimes spent the whole token budget "thinking" and returned `content: null`. GLM was also 4-5x
slower (20 s vs 2-5 s). Llama 3.3 70B was correct on Hindi, Tamil and romanised Hinglish
transcripts, in both English and same-language output.

## Behaviours to know
- `response_format: json_schema` works; the parsed object arrives in `response` (plain mode: a string in `choices[0].message.content`). `notes.ts` accepts both.
- The model **ignores the output language** if the prompt is not emphatic. `generateNotes` therefore checks the script
  (Devanagari/Tamil share of letters) and retries once with a correction.
- Asking for "3-6 sentences" made it pad with filler, and on the merge call it ran away to the token cap (55 s, `finish_reason: length`).
  The prompt now caps summaries by sentence/word count, forbids filler, and `max_tokens` is 1200.
- Cost: about 30 neurons per chunk call. Workers AI's free allowance is 10,000 neurons/day.

## Map-reduce
Transcript text is cut into <= 8000-character chunks on segment boundaries. Each chunk becomes partial notes
(3 in parallel); partials are saved to `meeting_notes.raw_llm_output` after each batch so a later request resumes.
Partials are then merged (grouped if large). If the merge fails twice, a plain join/dedupe is used.
6 chunks + merge = 14.6 s.

## Due dates
`action_items.due_date` is a SQL `date`. The model returns an ISO date, `today`, `tomorrow` or a weekday name;
`resolveDueDate` turns that into a date relative to the meeting day (a weekday equal to the meeting's own
weekday means next week). Anything else becomes null.
