// Tiny Worker used only by scripts/benchmark-asr.mjs. It calls Whisper with exactly the options production uses
// (see functions/lib/whisper.ts) but returns the full result, including the detected language.
import { toBase64 } from '../../functions/lib/whisper.ts'

export default {
  async fetch(req, env) {
    const lang = new URL(req.url).searchParams.get('lang')
    const audio = await req.arrayBuffer()
    const input = { audio: toBase64(new Uint8Array(audio)), vad_filter: true, condition_on_previous_text: false }
    if (lang) input.language = lang
    // Experiments: extra Whisper options, URL-encoded JSON in a header (header values must be ASCII).
    const extra = req.headers.get('x-opts')
    if (extra) Object.assign(input, JSON.parse(decodeURIComponent(extra)))
    const t0 = Date.now()
    try {
      const out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', input)
      return Response.json({ ok: true, ms: Date.now() - t0, text: out.text ?? '', info: out.transcription_info ?? null })
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 500 })
    }
  },
}
