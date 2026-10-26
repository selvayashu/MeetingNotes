import { describe, expect, it, vi } from 'vitest'
import { crc32, makeZip } from '../src/lib/zip'

const supabase = vi.hoisted(() => ({ from: vi.fn(), storage: { from: vi.fn() } }))
vi.mock('../src/lib/supabase', () => ({ supabase }))

import { buildArchive, fetchAllData, type AllData } from '../src/lib/dataExport'

/** A small ZIP reader, independent of the writer, so the test proves a standard reader can open the file. */
async function readZip(blob: Blob): Promise<Record<string, Uint8Array>> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const v = new DataView(buf.buffer)
  let eocd = buf.length - 22
  while (v.getUint32(eocd, true) !== 0x06054b50) eocd--
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: Record<string, Uint8Array> = {}
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50)
    const crc = v.getUint32(p + 16, true)
    const size = v.getUint32(p + 24, true)
    const nameLen = v.getUint16(p + 28, true)
    const localAt = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen))
    const lNameLen = v.getUint16(localAt + 26, true)
    const start = localAt + 30 + lNameLen
    const data = buf.subarray(start, start + size)
    expect(crc32(data), `crc of ${name}`).toBe(crc)
    out[name] = data
    p += 46 + nameLen
  }
  return out
}
const text = (b: Uint8Array) => new TextDecoder().decode(b)

describe('zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('round-trips files, including Hindi/Tamil names, empty files and Blobs', async () => {
    const zip = await makeZip([
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'बैठक/தமிழ்.md', data: new TextEncoder().encode('नमस्ते') },
      { name: 'empty', data: new Uint8Array() },
      { name: 'blob.bin', data: new Blob([new Uint8Array([1, 2, 3])]) },
    ])
    const files = await readZip(zip)
    expect(Object.keys(files)).toEqual(['a.txt', 'बैठक/தமிழ்.md', 'empty', 'blob.bin'])
    expect(text(files['a.txt'])).toBe('hello')
    expect(text(files['बैठक/தமிழ்.md'])).toBe('नमस्ते')
    expect(files['empty'].length).toBe(0)
    expect([...files['blob.bin']]).toEqual([1, 2, 3])
  })

  it('makes a valid empty archive', async () => {
    expect(await readZip(await makeZip([]))).toEqual({})
  })
})

const meeting = (id: string, title: string, date: string) =>
  ({ id, title, meeting_date: `${date}T09:00:00Z`, language: 'en', notes_language: 'en', duration_seconds: 600, status: 'done', audio_parts: [], audio_path: null }) as never

const data = (): AllData => ({
  email: 'a@x.co',
  exportedAt: '2026-10-28T10:00:00.000Z',
  profile: { full_name: 'Ann', preferred_language: 'en', delete_audio_after_notes: false, created_at: '2026-01-01T00:00:00Z' },
  meetings: [meeting('m1', 'Kickoff', '2026-10-01'), meeting('m2', 'Kickoff', '2026-10-01')],
  notes: { m1: { summary: 'We kicked off.', decisions: ['Go'], generated_at: null } },
  items: { m1: [{ id: 'i1', task: 'Send plan', owner: 'Ann', due_date: '2026-10-05', is_done: false }] },
  segments: { m1: [{ id: 's1', start_ms: 0, end_ms: 1000, text: 'Hello team', original_text: null, edited_at: null }] },
})

describe('archive', () => {
  it('has a README, one JSON with everything, and one readable file per meeting', async () => {
    const files = await readZip(await buildArchive(data(), null))
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'meetings.json',
      'meetings/2026-10-01-Kickoff-m2.md',
      'meetings/2026-10-01-Kickoff.md',
    ].sort())
    expect(text(files['README.txt'])).toContain('Audio recordings are not included')
    const json = JSON.parse(text(files['meetings.json']))
    expect(json.account).toMatchObject({ email: 'a@x.co', full_name: 'Ann' })
    expect(json.meetings[0].notes.summary).toBe('We kicked off.')
    expect(json.meetings[0].action_items).toEqual([{ task: 'Send plan', owner: 'Ann', due_date: '2026-10-05', is_done: false }])
    expect(json.meetings[0].transcript[0].text).toBe('Hello team')
    expect(json.meetings[1].notes).toBeNull()
    const md = text(files['meetings/2026-10-01-Kickoff.md'])
    expect(md).toContain('We kicked off.')
    expect(md).toContain('Send plan')
    expect(md).toContain('Hello team')
  })

  it('keeps two meetings with the same title and day apart', async () => {
    const names = Object.keys(await readZip(await buildArchive(data(), null))).filter((n) => n.endsWith('.md'))
    expect(new Set(names).size).toBe(2)
  })

  it('includes audio when given, and lists files that could not be fetched', async () => {
    const files = await readZip(
      await buildArchive(data(), { files: [{ name: 'audio/m1/000.wav', data: new Blob([new Uint8Array([9, 9])]) }], missing: ['audio/m2/000.wav'] }),
    )
    expect([...files['audio/m1/000.wav']]).toEqual([9, 9])
    expect(text(files['README.txt'])).toContain('audio/m2/000.wav')
  })
})

describe('reading everything', () => {
  it('pages past the 1,000-row API limit and groups rows by meeting', async () => {
    const pages: Record<string, unknown[][]> = {
      meetings: [Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}` })), [{ id: 'm1000' }]],
      meeting_notes: [[]],
      action_items: [[{ id: 'a', meeting_id: 'm1000' }, { id: 'b', meeting_id: 'm1000' }]],
      transcript_segments: [[]],
    }
    const calls: Record<string, number> = {}
    supabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        const b: Record<string, unknown> = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }) }
        return b
      }
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        range: async () => ({ data: pages[table][calls[table] = (calls[table] ?? -1) + 1] ?? [], error: null }),
      }
      return b
    })
    const d = await fetchAllData('u1', 'a@x.co')
    expect(d.meetings).toHaveLength(1001)
    expect(calls.meetings).toBe(1)
    expect(d.items['m1000']).toHaveLength(2)
  })

  it('fails loudly rather than exporting a partial file', async () => {
    supabase.from.mockImplementation(() => {
      const b: Record<string, unknown> = {
        select: () => b, order: () => b, eq: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
        range: async () => ({ data: null, error: { message: 'permission denied' } }),
      }
      return b
    })
    await expect(fetchAllData('u1', 'a@x.co')).rejects.toThrow('permission denied')
  })
})
