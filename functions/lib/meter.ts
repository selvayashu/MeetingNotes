import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Records how much AI work processing a meeting uses, so the app can show it and enforce a daily cap.
 *
 * Workers AI bills in "neurons". Most responses report them (`usage.neurons`); when one does not we estimate from what
 * we know and mark the row `estimated`:
 *  - speech: about 46.6 neurons per audio minute (Whisper large-v3-turbo, $0.000513/min at $0.011 per 1,000 neurons)
 *  - text:  Llama 3.3 70B fp8-fast, $0.293 / $2.253 per million input / output tokens
 *           => 0.026664 and 0.204818 neurons per token. Checked against a real response:
 *           314 in + 105 out = 29.9 estimated vs 29.88 reported.
 * Other LLM_MODEL choices are priced differently, so their estimates are rough (they are flagged as estimates anyway).
 */
export const NEURONS_PER_AUDIO_MINUTE = 46.6
export const NEURONS_PER_INPUT_TOKEN = 0.026664
export const NEURONS_PER_OUTPUT_TOKEN = 0.204818

export interface CallUsage {
  kind: 'transcribe' | 'notes'
  audioSeconds: number
  tokensIn: number
  tokensOut: number
  neurons: number
  estimated: boolean
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** Work out the usage of one AI response. Never throws: odd shapes just count as zero. */
export function usageOf(model: string, out: unknown): CallUsage {
  const o = (out ?? {}) as {
    usage?: { neurons?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown }
    transcription_info?: { duration?: unknown }
  }
  const kind = /whisper/i.test(model) ? 'transcribe' : 'notes'
  const audioSeconds = kind === 'transcribe' ? num(o.transcription_info?.duration) : 0
  const tokensIn = num(o.usage?.prompt_tokens)
  const tokensOut = num(o.usage?.completion_tokens)
  const reported = o.usage?.neurons
  if (typeof reported === 'number' && Number.isFinite(reported) && reported >= 0) {
    return { kind, audioSeconds, tokensIn, tokensOut, neurons: reported, estimated: false }
  }
  const neurons =
    kind === 'transcribe'
      ? (audioSeconds / 60) * NEURONS_PER_AUDIO_MINUTE
      : tokensIn * NEURONS_PER_INPUT_TOKEN + tokensOut * NEURONS_PER_OUTPUT_TOKEN
  return { kind, audioSeconds, tokensIn, tokensOut, neurons, estimated: true }
}

/** Wraps the `AI` binding: calls pass straight through and are counted; `flush` stores the totals. */
export class Meter {
  private calls: (CallUsage & { model: string })[] = []

  constructor(private readonly inner: Ai) {}

  /** Drop-in for `env.AI` wherever only `.run` is used. */
  readonly ai = {
    run: async (model: string, input: unknown, ...rest: unknown[]) => {
      const out = await (this.inner.run as (...a: unknown[]) => Promise<unknown>)(model, input, ...rest)
      this.calls.push({ ...usageOf(model, out), model })
      return out
    },
  } as unknown as Ai

  get totalNeurons(): number {
    return this.calls.reduce((s, c) => s + c.neurons, 0)
  }

  /** One row per kind of work (speech / text). Failure to log must never break processing. */
  async flush(db: SupabaseClient, ctx: { userId: string; meetingId?: string }): Promise<void> {
    const rows = (['transcribe', 'notes'] as const).flatMap((kind) => {
      const cs = this.calls.filter((c) => c.kind === kind)
      if (cs.length === 0) return []
      return [{
        user_id: ctx.userId || null,
        meeting_id: ctx.meetingId ?? null,
        kind,
        model: cs[0].model,
        calls: cs.length,
        audio_seconds: Math.round(cs.reduce((s, c) => s + c.audioSeconds, 0) * 100) / 100,
        tokens_in: Math.round(cs.reduce((s, c) => s + c.tokensIn, 0)),
        tokens_out: Math.round(cs.reduce((s, c) => s + c.tokensOut, 0)),
        neurons: Math.round(cs.reduce((s, c) => s + c.neurons, 0) * 1000) / 1000,
        estimated: cs.some((c) => c.estimated),
      }]
    })
    this.calls = []
    if (rows.length === 0) return
    try {
      const { error } = await db.from('ai_usage').insert(rows)
      if (error) console.error('ai_usage insert failed', error.message)
    } catch (e) {
      console.error('ai_usage insert threw', e)
    }
  }
}
