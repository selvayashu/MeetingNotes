import { describe, expect, it, vi } from 'vitest'
import { acceptable, batches, fixHindiLines, parseNumbered, shouldFixHindi } from '../functions/lib/fixText'
import { usageOf } from '../functions/lib/meter'
import { toSegmentRows } from '../functions/lib/segments'

const ai = (reply: (numbered: string) => string | Promise<string> | Error) => ({
  run: vi.fn(async (_model: string, input: unknown) => {
    const user = (input as { messages: { content: string }[] }).messages[1].content
    const r = await reply(user)
    if (r instanceof Error) throw r
    return { response: r }
  }),
})
const lines = (...t: string[]) => t.map((text) => ({ text }))

describe('when the clean-up runs', () => {
  it('only for Hindi: chosen, or detected on Auto-detect', () => {
    const on = {}
    expect(shouldFixHindi(on, 'hi', undefined)).toBe(true)
    expect(shouldFixHindi(on, 'auto', 'hi')).toBe(true)
    expect(shouldFixHindi(on, 'auto', 'en')).toBe(false)
    expect(shouldFixHindi(on, 'auto', undefined)).toBe(false)
    expect(shouldFixHindi(on, 'en', 'hi')).toBe(false) // the person said English
    expect(shouldFixHindi(on, 'ta', 'ta')).toBe(false) // Tamil gained too little to be worth the cost
  })
  it('can be switched off', () => {
    expect(shouldFixHindi({ HINDI_FIX: 'off' }, 'hi', 'hi')).toBe(false)
  })
})

describe('numbered replies', () => {
  it('reads "N: text" in the usual shapes and ignores chatter', () => {
    const m = parseNumbered('Here you go:\n1: पहली पंक्ति\n2) दूसरी\n 3 : तीसरी  \n3: duplicate ignored')
    expect([...m.entries()]).toEqual([[1, 'पहली पंक्ति'], [2, 'दूसरी'], [3, 'तीसरी']])
  })
})

describe('batching', () => {
  it('keeps batches small and preserves every line and its position', () => {
    const many = lines(...Array.from({ length: 60 }, (_, i) => 'क'.repeat(100) + i))
    const bs = batches(many)
    expect(bs.length).toBeGreaterThan(2)
    expect(bs.every((b) => b.length <= 24 && b.reduce((n, x) => n + x.line.text.length, 0) <= 1900)).toBe(true)
    expect(bs.flat().map((x) => x.index)).toEqual(many.map((_, i) => i))
  })
  it('puts a single over-long line in a batch of its own', () => {
    expect(batches(lines('क'.repeat(5000), 'ख')).map((b) => b.length)).toEqual([1, 1])
  })
})

describe('what counts as a spelling fix', () => {
  const raw = 'कुछ अणूओं में आस्तिर केंद्रक होता है'
  it('accepts a plausible correction', () => {
    expect(acceptable(raw, 'कुछ अणुओं में अस्थिर केंद्रक होता है')).toBe(true)
  })
  it('rejects empty, translated, much longer, much shorter or heavily rewritten text', () => {
    expect(acceptable(raw, '')).toBe(false)
    expect(acceptable(raw, 'Some molecules have an unstable nucleus')).toBe(false) // translated
    expect(acceptable(raw, raw + ' ' + raw)).toBe(false)
    expect(acceptable(raw, 'कुछ')).toBe(false)
    expect(acceptable(raw, 'बिल्कुल अलग वाक्य है यह जिसमें कोई समानता नहीं बची')).toBe(false) // a rewrite
  })
  it('lets a mixed English/Hindi line be respelled but not turned into English', () => {
    expect(acceptable('यह client नाराज हो जाएगा', 'यह क्लाइंट नाराज हो जाएगा')).toBe(true)
    expect(acceptable('यह क्लाइंट नाराज हो जाएगा आज', 'this client will be upset today')).toBe(false)
  })
})

describe('fixHindiLines', () => {
  it('returns the corrected text per line, and null for lines that did not change', async () => {
    const a = ai((u) => u.split('\n').map((l) => l.replace('आस्तिर', 'अस्थिर')).join('\n'))
    const out = await fixHindiLines(a, lines('आस्तिर केंद्रक होता है', 'यह ठीक है'))
    expect(out).toEqual(['अस्थिर केंद्रक होता है', null])
    expect(a.run).toHaveBeenCalledTimes(1) // both lines in one call
  })

  it('keeps Whisper\'s text for a line the model rewrote beyond recognition', async () => {
    const a = ai(() => '1: बिल्कुल अलग वाक्य है यह जिसमें कोई समानता नहीं बची\n2: ठीक है')
    expect(await fixHindiLines(a, lines('आस्तिर केंद्रक होता है', 'ठीक हैं'))).toEqual([null, 'ठीक है'])
  })

  it('trusts nothing from a reply that skips a line (it could be misaligned)', async () => {
    const a = ai(() => '1: सही पंक्ति')
    expect(await fixHindiLines(a, lines('पंक्ति एक', 'पंक्ति दो'))).toEqual([null, null])
  })

  it('keeps everything when the model call fails or answers with prose', async () => {
    expect(await fixHindiLines(ai(() => new Error('AiError 3040')), lines('एक', 'दो'))).toEqual([null, null])
    expect(await fixHindiLines(ai(() => 'Sorry, I cannot help with that.'), lines('एक', 'दो'))).toEqual([null, null])
  })

  it('handles many lines across several parallel calls and keeps them in order', async () => {
    const input = lines(...Array.from({ length: 70 }, (_, i) => `यह पंक्ति नंबर ${i} है ` + 'क'.repeat(60)))
    const a = ai((u) => u.split('\n').map((l) => l.replace('यह', 'ये')).join('\n'))
    const out = await fixHindiLines(a, input)
    expect(out.every((t, i) => t === input[i].text.replace('यह', 'ये'))).toBe(true)
    expect(a.run.mock.calls.length).toBeGreaterThan(2)
  })

  it('does nothing for an empty transcript', async () => {
    const a = ai(() => '')
    expect(await fixHindiLines(a, [])).toEqual([])
    expect(a.run).not.toHaveBeenCalled()
  })
})

describe('storage and cost bookkeeping', () => {
  it('segment rows start with no Whisper original (only corrected lines get one)', () => {
    const rows = toSegmentRows('m1', 0, [{ start: 0, end: 2, text: ' नमस्ते ' }])
    expect(rows[0]).toMatchObject({ text: 'नमस्ते', asr_text: null })
  })

  it('estimates the small model\'s cost with its own prices, not the 70B model\'s', () => {
    const small = usageOf('@cf/meta/llama-3.1-8b-instruct-fp8', { usage: { prompt_tokens: 1000, completion_tokens: 1000 } })
    const big = usageOf('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { usage: { prompt_tokens: 1000, completion_tokens: 1000 } })
    expect(small.estimated).toBe(true)
    expect(small.neurons).toBeCloseTo(4.119 + 34.868, 2)
    expect(big.neurons).toBeGreaterThan(small.neurons * 5)
    expect(usageOf('@cf/meta/llama-3.1-8b-instruct-fp8', { usage: { neurons: 12.5 } })).toMatchObject({ neurons: 12.5, estimated: false })
  })
})
