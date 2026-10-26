// Tiny Worker used only by the accuracy scripts (scripts/benchmark-asr.mjs and the experiments in docs/accuracy.md).
// By default it calls Whisper with exactly the options production uses (see functions/lib/whisper.ts) and returns the
// text, the detected language and the raw segments. It can also try other models and run the notes LLM.
//
//   POST /?lang=hi[&model=@cf/openai/whisper-large-v3-turbo]   body: audio bytes     header x-opts: URL-encoded JSON of extra options
//   POST /llm                                                    body: {"model": "...", "messages": [...], "max_tokens": N}
import { toBase64 } from '../../functions/lib/whisper.ts'

const WHISPER = '@cf/openai/whisper-large-v3-turbo'

export default {
  async fetch(req, env) {
    const url = new URL(req.url)

    if (url.pathname === '/llm') {
      const { model, messages, max_tokens = 1500 } = await req.json()
      try {
        const out = await env.AI.run(model, { messages, max_tokens, temperature: 0 })
        return Response.json({ ok: true, text: out.response ?? out.choices?.[0]?.message?.content ?? '', usage: out.usage ?? null })
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 500 })
      }
    }

    const lang = url.searchParams.get('lang')
    const model = url.searchParams.get('model') || WHISPER
    const audio = new Uint8Array(await req.arrayBuffer())
    const extra = req.headers.get('x-opts')
    const opts = extra ? JSON.parse(decodeURIComponent(extra)) : {}
    const t0 = Date.now()
    try {
      let out
      if (model === WHISPER) {
        const input = { audio: toBase64(audio), vad_filter: true, condition_on_previous_text: false, ...opts }
        if (lang) input.language = lang
        out = await env.AI.run(model, input)
      } else if (model === '@cf/openai/whisper') {
        out = await env.AI.run(model, { audio: [...audio], ...opts })
      } else if (model === '@cf/deepgram/nova-3') {
        const input = { audio: { body: new Response(audio).body, contentType: 'audio/wav' }, punctuate: true, ...opts }
        if (lang) input.language = lang
        else input.detect_language = true
        out = await env.AI.run(model, input)
      } else {
        out = await env.AI.run(model, { audio: toBase64(audio), ...opts })
      }
      const dg = out.results?.channels?.[0]?.alternatives?.[0]
      return Response.json({
        ok: true,
        ms: Date.now() - t0,
        text: out.text ?? dg?.transcript ?? '',
        info: out.transcription_info ?? (dg ? { language: out.results?.channels?.[0]?.detected_language ?? null } : null),
        segments: out.segments ?? null,
        words: out.words ?? dg?.words ?? null,
      })
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 500 })
    }
  },
}
