import { describe, expect, it } from 'vitest'
import { activeSegmentIndex, buildTimeline, locate, totalMs } from '../src/lib/timeline'
import { buildMarkdown, buildPlainText, fileSlug, formatTimestamp } from '../src/lib/export'
import { partOffsetMs } from '../functions/lib/segments'
import type { ActionItem, Segment } from '../src/lib/types'

describe('timeline', () => {
  const parts = [
    { duration_seconds: 300, actual_ms: 300420 },
    { duration_seconds: 300 },
    { duration_seconds: 120 },
  ]
  const tl = buildTimeline(parts)

  it('uses real durations where known and matches the server offsets', () => {
    expect(tl.map((t) => t.startMs)).toEqual([0, 300420, 600420])
    expect(totalMs(tl)).toBe(720420)
    // The player and the transcript must agree on where each part starts.
    tl.forEach((t, i) => expect(t.startMs).toBe(partOffsetMs(parts, i)))
  })

  it('locates a time inside the right part', () => {
    expect(locate(tl, 0)).toEqual({ index: 0, offsetMs: 0 })
    expect(locate(tl, 300419)).toEqual({ index: 0, offsetMs: 300419 })
    expect(locate(tl, 300420)).toEqual({ index: 1, offsetMs: 0 })
    expect(locate(tl, 650420)).toEqual({ index: 2, offsetMs: 50000 })
  })

  it('clamps out-of-range times', () => {
    expect(locate(tl, -50)).toEqual({ index: 0, offsetMs: 0 })
    expect(locate(tl, 9_999_999)).toEqual({ index: 2, offsetMs: 120000 })
    expect(locate([], 5)).toEqual({ index: 0, offsetMs: 0 })
  })

  it('finds the active segment by binary search', () => {
    const segs = [{ start_ms: 0 }, { start_ms: 5000 }, { start_ms: 9000 }]
    expect(activeSegmentIndex(segs, -1)).toBe(-1)
    expect(activeSegmentIndex(segs, 0)).toBe(0)
    expect(activeSegmentIndex(segs, 4999)).toBe(0)
    expect(activeSegmentIndex(segs, 5000)).toBe(1)
    expect(activeSegmentIndex(segs, 99999)).toBe(2)
    expect(activeSegmentIndex([], 10)).toBe(-1)
  })
})

describe('export', () => {
  const meeting = { title: 'Launch sync', meeting_date: '2026-10-21T10:00:00Z', language: 'hi' as const, duration_seconds: 1830 }
  const notes = { summary: 'We chose Friday.', decisions: ['Launch Friday'] }
  const items: ActionItem[] = [
    { id: '1', task: 'Press release', owner: 'Priya', due_date: '2026-10-28', is_done: false },
    { id: '2', task: 'Confirm budget', owner: null, due_date: null, is_done: true },
  ]
  const segments: Segment[] = [
    { id: 'a', start_ms: 0, end_ms: 4000, text: 'नमस्ते सबको' },
    { id: 'b', start_ms: 3_725_000, end_ms: 3_730_000, text: 'Thanks all' },
  ]
  const data = { meeting, notes, items, segments }

  it('formats timestamps', () => {
    expect(formatTimestamp(0)).toBe('00:00')
    expect(formatTimestamp(65_400)).toBe('01:05')
    expect(formatTimestamp(3_725_000)).toBe('1:02:05')
  })

  it('builds markdown with checkboxes and optional transcript', () => {
    const md = buildMarkdown(data)
    expect(md).toContain('# Launch sync')
    expect(md).toContain('*2026-10-21 · Hindi · 31 min*')
    expect(md).toContain('## Decisions\n\n- Launch Friday')
    expect(md).toContain('- [ ] Press release (Priya, due 2026-10-28)')
    expect(md).toContain('- [x] Confirm budget')
    expect(md).not.toContain('## Transcript')
    const full = buildMarkdown(data, { transcript: true })
    expect(full).toContain('**[00:00]** नमस्ते सबको')
    expect(full).toContain('**[1:02:05]** Thanks all')
  })

  it('omits empty sections', () => {
    const md = buildMarkdown({ meeting, notes: null, items: [], segments: [] })
    expect(md).toBe('# Launch sync\n\n*2026-10-21 · Hindi · 31 min*\n')
  })

  it('builds plain text without markdown syntax', () => {
    const txt = buildPlainText(data, { transcript: true })
    expect(txt).not.toMatch(/[#*]/)
    expect(txt).toContain('SUMMARY\nWe chose Friday.')
    expect(txt).toContain('[ ] Press release (Priya, due 2026-10-28)')
    expect(txt).toContain('[00:00] नमस्ते सबको')
  })

  it('makes safe filenames that keep Indic letters', () => {
    expect(fileSlug('Launch sync / Q4?')).toBe('Launch-sync-Q4')
    expect(fileSlug('புதிய இணையதளம்')).toBe('புதிய-இணையதளம்')
    expect(fileSlug('///')).toBe('meeting')
  })
})
