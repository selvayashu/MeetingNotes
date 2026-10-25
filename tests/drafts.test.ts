import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  STALE_AFTER_MS,
  appendChunk,
  closeSegment,
  createDraft,
  deleteDraft,
  listRecoverable,
  loadDraftParts,
} from '../src/lib/drafts'

const bytes = (...n: number[]) => new Blob([new Uint8Array(n)])
const read = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())]

describe('crash-safe recording drafts', () => {
  it('rebuilds each segment from its chunks, in order, even if they were written out of order', async () => {
    const id = await createDraft('u1', 'audio/webm;codecs=opus')
    await appendChunk(id, 0, 1, bytes(3, 4))
    await appendChunk(id, 0, 0, bytes(1, 2))
    await appendChunk(id, 0, 2, bytes(5))
    await appendChunk(id, 1, 0, bytes(9, 9))

    const parts = await loadDraftParts(id)
    expect(parts).toHaveLength(2)
    expect(await read(parts[0].blob)).toEqual([1, 2, 3, 4, 5])
    expect(await read(parts[1].blob)).toEqual([9, 9])
    expect(parts[0].blob.type).toBe('audio/webm;codecs=opus')
  })

  it('uses the recorded length for finished segments and the chunk count (~1 s each) for an interrupted one', async () => {
    const id = await createDraft('u1', 'audio/webm')
    for (let i = 0; i < 300; i++) await appendChunk(id, 0, i, bytes(i % 256))
    await closeSegment(id, 0, 300.4)
    for (let i = 0; i < 42; i++) await appendChunk(id, 1, i, bytes(1)) // the crash happened here
    const parts = await loadDraftParts(id)
    expect(parts.map((p) => p.durationSeconds)).toEqual([300, 42])
  })

  it('only offers recordings that stopped being written to, and only to their owner', async () => {
    const mine = await createDraft('owner', 'audio/webm')
    await appendChunk(mine, 0, 0, bytes(1))
    const theirs = await createDraft('someone-else', 'audio/webm')
    await appendChunk(theirs, 0, 0, bytes(1))

    const now = Date.now()
    expect((await listRecoverable('owner', now)).map((d) => d.draft.id)).not.toContain(mine) // still being written
    const later = now + STALE_AFTER_MS + 1000
    const found = await listRecoverable('owner', later)
    expect(found.map((d) => d.draft.id)).toContain(mine)
    expect(found.map((d) => d.draft.id)).not.toContain(theirs)
    expect(found.find((d) => d.draft.id === mine)!.chunkCount).toBe(1)
  })

  it('throws away a draft that never received any audio instead of offering it', async () => {
    const empty = await createDraft('empty-user', 'audio/webm')
    expect(await listRecoverable('empty-user', Date.now() + STALE_AFTER_MS + 1000)).toEqual([])
    expect(await loadDraftParts(empty)).toEqual([])
  })

  it('deleting a draft removes its chunks too', async () => {
    const id = await createDraft('u2', 'audio/webm')
    await appendChunk(id, 0, 0, bytes(1))
    await appendChunk(id, 0, 1, bytes(2))
    await deleteDraft(id)
    expect(await loadDraftParts(id)).toEqual([])
    expect(await listRecoverable('u2', Date.now() + STALE_AFTER_MS + 1000)).toEqual([])
  })

  it('lists the newest recoverable draft first', async () => {
    const a = await createDraft('multi', 'audio/webm')
    await appendChunk(a, 0, 0, bytes(1))
    await new Promise((r) => setTimeout(r, 5))
    const b = await createDraft('multi', 'audio/webm')
    await appendChunk(b, 0, 0, bytes(1))
    const found = await listRecoverable('multi', Date.now() + STALE_AFTER_MS + 1000)
    expect(found.map((d) => d.draft.id)).toEqual([b, a])
  })
})

import { defaultSpokenLanguage } from '../src/lib/spokenLanguage'

describe('default spoken language (measured: auto-detect is much worse for Hindi)', () => {
  it('prefers the last choice, then a Hindi/Tamil interface, then auto-detect', () => {
    expect(defaultSpokenLanguage('ta', 'en')).toBe('ta')
    expect(defaultSpokenLanguage('auto', 'hi')).toBe('auto') // an explicit saved choice always wins
    expect(defaultSpokenLanguage(null, 'hi')).toBe('hi')
    expect(defaultSpokenLanguage(null, 'ta')).toBe('ta')
    expect(defaultSpokenLanguage(null, 'en')).toBe('auto')
    expect(defaultSpokenLanguage('klingon', 'en')).toBe('auto') // junk in storage is ignored
  })
})
