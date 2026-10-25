import { describe, expect, it, vi } from 'vitest'
import {
  chunkTranscript,
  extractJson,
  indicRatio,
  mergeNotesPlain,
  notesFromChunk,
  reduceNotes,
  resolveDueDate,
  summariseStep,
  type Notes,
  type NotesOptions,
  type SummaryState,
} from '../functions/lib/notes'

const opts: NotesOptions = { outLang: 'en', meetingDateIso: '2026-10-21T10:00:00Z' } // a Wednesday

const good = (summary: string, extra: Partial<Notes> = {}) =>
  ({ summary, decisions: [], action_items: [], ...extra }) as Notes

/** Fake Workers AI: `reply(systemPrompt, userContent, callIndex)` returns what the model "says". */
function fakeAi(reply: (sys: string, user: string, n: number) => unknown) {
  let n = 0
  const run = vi.fn(async (_model: string, input: { messages: { role: string; content: string }[] }) => {
    const sys = input.messages[0].content
    const last = input.messages[input.messages.length - 1].content
    const r = reply(sys, last, n++)
    if (r instanceof Error) throw r
    return typeof r === 'string' ? { choices: [{ message: { content: r } }] } : { response: r }
  })
  return { ai: { run } as unknown as Ai, run }
}

describe('chunkTranscript', () => {
  it('packs segments up to the limit without splitting them', () => {
    const chunks = chunkTranscript(['aaaa', 'bbbb', 'cccc', 'dd'], 9)
    expect(chunks).toEqual(['aaaa\nbbbb', 'cccc\ndd'])
  })
  it('hard-splits a single oversized segment and skips blanks', () => {
    expect(chunkTranscript(['  ', 'x'.repeat(25)], 10).map((c) => c.length)).toEqual([10, 10, 5])
  })
  it('returns nothing for an empty transcript', () => {
    expect(chunkTranscript([])).toEqual([])
  })
})

describe('parsing helpers', () => {
  it('extracts JSON from fences and chatter', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Sure! Here you go: {"a":{"b":2}} Hope that helps')).toEqual({ a: { b: 2 } })
    expect(() => extractJson('no json here')).toThrow()
  })
  it('measures Indic script share', () => {
    expect(indicRatio('Launch on Friday')).toBe(0)
    expect(indicRatio('வெள்ளிக்கிழமை வெளியீடு')).toBeGreaterThan(0.9)
    expect(indicRatio('Launch शुक्रवार')).toBeGreaterThan(0.4)
    expect(indicRatio('1234 !!')).toBe(0)
  })
  it('resolves due dates relative to the meeting day (Wed 2026-10-21)', () => {
    const r = (s: string | null) => resolveDueDate(s, opts.meetingDateIso)
    expect(r('friday')).toBe('2026-10-23')
    expect(r('Wednesday')).toBe('2026-10-28') // same weekday means next week
    expect(r('monday')).toBe('2026-10-26')
    expect(r('by Friday')).toBe('2026-10-23')
    expect(r('tomorrow')).toBe('2026-10-22')
    expect(r('today')).toBe('2026-10-21')
    expect(r('2026-11-05')).toBe('2026-11-05')
    expect(r('2026-02-31')).toBeNull()
    expect(r('soon')).toBeNull()
    expect(r(null)).toBeNull()
  })
})

describe('notesFromChunk (validation + retry)', () => {
  it('normalises null-ish owners and dates', async () => {
    const { ai } = fakeAi(() => ({
      summary: 'S',
      decisions: ['D'],
      action_items: [{ task: 'T', owner: 'None', due_date: '' }],
    }))
    const { notes } = await notesFromChunk(ai, 'm', 'text', opts)
    expect(notes.action_items[0]).toEqual({ task: 'T', owner: null, due_date: null })
  })

  it('retries once after invalid JSON, feeding back the problem', async () => {
    const { ai, run } = fakeAi((_s, _u, n) => (n === 0 ? 'I think the meeting was good' : '{"summary":"ok"}'))
    const { notes } = await notesFromChunk(ai, 'm', 'text', opts)
    expect(notes.summary).toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
    const second = run.mock.calls[1][1].messages
    expect(second.at(-1)!.content).toContain('not valid')
  })

  it('retries when the notes come back in the wrong language', async () => {
    const { ai, run } = fakeAi((_s, _u, n) =>
      n === 0 ? { summary: 'வெள்ளிக்கிழமை வெளியீடு பற்றி பேசினோம்' } : { summary: 'We discussed the Friday launch' },
    )
    const { notes } = await notesFromChunk(ai, 'm', 'text', opts)
    expect(notes.summary).toMatch(/Friday launch/)
    expect(run.mock.calls[1][1].messages.at(-1)!.content).toContain('wrong language')
  })

  it('requires Tamil output when Tamil is requested', async () => {
    const { ai } = fakeAi((_s, _u, n) => (n === 0 ? { summary: 'English only' } : { summary: 'கூட்டம் நடந்தது' }))
    const { notes } = await notesFromChunk(ai, 'm', 'x', { ...opts, outLang: 'ta' })
    expect(notes.summary).toBe('கூட்டம் நடந்தது')
  })

  it('gives up after one retry with a clear error', async () => {
    const { ai, run } = fakeAi(() => 'garbage')
    await expect(notesFromChunk(ai, 'm', 'x', opts)).rejects.toThrow(/unusable notes/)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('accepts string content too (non-JSON-mode shape)', async () => {
    const { ai } = fakeAi(() => '```json\n{"summary":"fenced"}\n```')
    expect((await notesFromChunk(ai, 'm', 'x', opts)).notes.summary).toBe('fenced')
  })
})

describe('reduce + fallback', () => {
  it('dedupes in the plain merge', () => {
    const a = good('A', { decisions: ['Ship Friday'], action_items: [{ task: 'Press release', owner: 'Priya', due_date: null }] })
    const b = good('B', { decisions: ['ship  friday'], action_items: [{ task: 'press release', owner: 'priya', due_date: null }] })
    const m = mergeNotesPlain([a, b])
    expect(m.decisions).toHaveLength(1)
    expect(m.action_items).toHaveLength(1)
    expect(m.summary).toBe('A\n\nB')
  })

  it('falls back to a plain merge when the LLM merge keeps failing', async () => {
    const { ai } = fakeAi(() => 'nope')
    const out = await reduceNotes(ai, 'm', [good('One'), good('Two')], opts)
    expect(out.summary).toBe('One\n\nTwo')
  })

  it('merges hierarchically when partials are large', async () => {
    const big = (i: number) => good(`S${i} ` + 'x'.repeat(5000))
    const { ai, run } = fakeAi((sys) => (sys.includes('merge several') ? { summary: 'merged' } : { summary: 'x' }))
    const out = await reduceNotes(ai, 'm', [big(1), big(2), big(3), big(4)], opts)
    expect(out.summary).toBe('merged')
    expect(run.mock.calls.length).toBeGreaterThan(1) // more than one merge call was needed
  })
})

describe('summariseStep (resumable map-reduce)', () => {
  const chunks = ['c0', 'c1', 'c2', 'c3', 'c4']
  const reply = (sys: string, user: string) =>
    sys.includes('merge several') ? { summary: 'FINAL' } : { summary: 'sum of ' + user.match(/c\d/)![0] }

  it('stops at the deadline, then resumes from saved state without redoing chunks', async () => {
    const saved: SummaryState[] = []
    const save = async (s: SummaryState) => void saved.push(structuredClone(s))
    const f1 = fakeAi(reply)

    const first = await summariseStep({
      ai: f1.ai, model: 'm', chunks, state: null, options: opts, deadline: 0, save,
    })
    expect(first.done).toBe(false)
    expect(first.processed).toBe(3) // one batch of CONCURRENCY=3 always runs
    expect(f1.run).toHaveBeenCalledTimes(3)

    const f2 = fakeAi(reply)
    const second = await summariseStep({
      ai: f2.ai, model: 'm', chunks, state: saved.at(-1)!, options: opts, deadline: Date.now() + 60_000, save,
    })
    expect(second.done).toBe(true)
    expect(second.notes!.summary).toBe('FINAL')
    // 2 remaining chunks + merge calls; the first 3 chunks were not re-run
    const chunkCalls = f2.run.mock.calls
      .map((c) => c[1].messages.at(-1)!.content)
      .filter((u) => u.startsWith('Transcript:'))
    expect(chunkCalls).toHaveLength(2)
    expect(chunkCalls.join('\n')).toMatch(/c3[\s\S]*c4/)
    expect(chunkCalls.join('\n')).not.toMatch(/c[012]/)
  })

  it('discards saved state when the transcript chunking changed', async () => {
    const stale: SummaryState = { model: 'm', total: 2, partials: [good('old'), good('old')] }
    const f = fakeAi(reply)
    const r = await summariseStep({
      ai: f.ai, model: 'm', chunks: ['c0'], state: stale, options: opts, deadline: Date.now() + 60_000, save: async () => {},
    })
    expect(r.done).toBe(true)
    expect(r.notes!.summary).toBe('sum of c0') // single chunk: no merge call
  })

  it('a single chunk skips the merge step', async () => {
    const f = fakeAi(reply)
    const r = await summariseStep({
      ai: f.ai, model: 'm', chunks: ['c0'], state: null, options: opts, deadline: Date.now() + 60_000, save: async () => {},
    })
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(r.notes!.summary).toBe('sum of c0')
  })
})
