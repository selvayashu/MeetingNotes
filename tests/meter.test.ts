import { describe, expect, it, vi } from 'vitest'
import { Meter, NEURONS_PER_AUDIO_MINUTE, usageOf } from '../functions/lib/meter'

const WHISPER = '@cf/openai/whisper-large-v3-turbo'
const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

describe('usageOf', () => {
  it('prefers the neurons Cloudflare reports', () => {
    const u = usageOf(LLAMA, { usage: { prompt_tokens: 314, completion_tokens: 105, neurons: 29.878 } })
    expect(u).toMatchObject({ kind: 'notes', neurons: 29.878, estimated: false, tokensIn: 314, tokensOut: 105 })
  })

  it('estimates text usage within 1% of a real Cloudflare response when neurons are missing', () => {
    // Real response from earlier testing: 314 prompt + 105 completion tokens was reported as 29.878 neurons.
    const u = usageOf(LLAMA, { usage: { prompt_tokens: 314, completion_tokens: 105 } })
    expect(u.estimated).toBe(true)
    expect(Math.abs(u.neurons - 29.878) / 29.878).toBeLessThan(0.01)
  })

  it('estimates speech by audio length', () => {
    const u = usageOf(WHISPER, { transcription_info: { duration: 120 } })
    expect(u).toMatchObject({ kind: 'transcribe', audioSeconds: 120, estimated: true })
    expect(u.neurons).toBeCloseTo(2 * NEURONS_PER_AUDIO_MINUTE, 5)
  })

  it('uses the reported neurons for speech too, but still records the audio length', () => {
    const u = usageOf(WHISPER, { transcription_info: { duration: 30 }, usage: { neurons: 7.5 } })
    expect(u).toMatchObject({ kind: 'transcribe', neurons: 7.5, audioSeconds: 30, estimated: false })
  })

  it('never throws on odd or empty responses', () => {
    for (const bad of [undefined, null, {}, 'text', 42, { usage: 'x' }, { usage: { neurons: -5 } }, { usage: { prompt_tokens: NaN } }]) {
      const u = usageOf(LLAMA, bad)
      expect(Number.isFinite(u.neurons)).toBe(true)
      expect(u.neurons).toBeGreaterThanOrEqual(0)
    }
  })
})

function fakeDb(result: { error: { message: string } | null } | 'throw' = { error: null }) {
  const insert = vi.fn(async (_rows: unknown) => {
    if (result === 'throw') throw new Error('network')
    return result
  })
  return { db: { from: vi.fn(() => ({ insert })) } as never, insert }
}
const inner = (responses: Record<string, unknown>) => ({ run: vi.fn(async (model: string) => responses[model]) }) as unknown as Ai

describe('Meter', () => {
  it('passes calls through unchanged and returns the model output', async () => {
    const ai = inner({ [LLAMA]: { response: 'hi', usage: { neurons: 10 } } })
    const m = new Meter(ai)
    const out = await (m.ai as unknown as { run: (model: string, input: unknown) => Promise<unknown> }).run(LLAMA, { prompt: 'x' })
    expect(out).toEqual({ response: 'hi', usage: { neurons: 10 } })
    expect((ai.run as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]).toEqual([LLAMA, { prompt: 'x' }])
  })

  it('stores one aggregated row per kind with the meeting and user', async () => {
    const m = new Meter(inner({
      [WHISPER]: { transcription_info: { duration: 60 }, usage: { neurons: 40 } },
      [LLAMA]: { usage: { prompt_tokens: 100, completion_tokens: 50, neurons: 12.5 } },
    }))
    const run = (m.ai as unknown as { run: (model: string, input: unknown) => Promise<unknown> }).run
    await run(WHISPER, {}); await run(WHISPER, {}); await run(LLAMA, {}); await run(LLAMA, {}); await run(LLAMA, {})
    expect(m.totalNeurons).toBeCloseTo(80 + 37.5, 5)

    const { db, insert } = fakeDb()
    await m.flush(db, { userId: 'u1', meetingId: 'm1' })
    const rows = insert.mock.calls[0][0] as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.kind === 'transcribe')).toMatchObject({ user_id: 'u1', meeting_id: 'm1', calls: 2, audio_seconds: 120, neurons: 80, estimated: false, model: WHISPER })
    expect(rows.find((r) => r.kind === 'notes')).toMatchObject({ calls: 3, tokens_in: 300, tokens_out: 150, neurons: 37.5 })
  })

  it('flags a row as estimated if any call in it had to be estimated', async () => {
    const m = new Meter(inner({ [LLAMA]: { usage: { prompt_tokens: 10, completion_tokens: 10 } } }))
    await (m.ai as unknown as { run: (model: string, input: unknown) => Promise<unknown> }).run(LLAMA, {})
    const { db, insert } = fakeDb()
    await m.flush(db, { userId: 'u1' })
    expect((insert.mock.calls[0][0] as { estimated: boolean }[])[0].estimated).toBe(true)
  })

  it('writes nothing when no AI was used, and does not write twice', async () => {
    const { db, insert } = fakeDb()
    const m = new Meter(inner({ [LLAMA]: { usage: { neurons: 1 } } }))
    await m.flush(db, { userId: 'u1' })
    expect(insert).not.toHaveBeenCalled()
    await (m.ai as unknown as { run: (model: string, input: unknown) => Promise<unknown> }).run(LLAMA, {})
    await m.flush(db, { userId: 'u1' })
    await m.flush(db, { userId: 'u1' })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('a failure to log usage never breaks processing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const result of [{ error: { message: 'boom' } }, 'throw'] as const) {
      const m = new Meter(inner({ [LLAMA]: { usage: { neurons: 1 } } }))
      await (m.ai as unknown as { run: (model: string, input: unknown) => Promise<unknown> }).run(LLAMA, {})
      await expect(m.flush(fakeDb(result).db, { userId: 'u1' })).resolves.toBeUndefined()
    }
    spy.mockRestore()
  })
})
