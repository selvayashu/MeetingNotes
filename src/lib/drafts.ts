import { openDB, type DBSchema } from 'idb'

/**
 * Crash-safe recording: every ~1 s audio chunk is written to IndexedDB as soon as MediaRecorder produces it.
 * If the tab dies mid-meeting, the chunks are still on the device and the Record page offers to recover them.
 * A draft is deleted once the finished recording has been handed to the upload queue (see lib/queue.ts).
 */

export interface Draft {
  id: string
  userId: string
  mime: string
  startedAt: number
  /** Last time a chunk was written (throttled); used to tell a crashed recording from one still in progress. */
  updatedAt: number
  /** Real length of segments that finished normally, in seconds. */
  segmentSeconds: Record<number, number>
}

interface ChunkRow {
  draftId: string
  seg: number
  seq: number
  blob: Blob
}

interface DraftsDB extends DBSchema {
  drafts: { key: string; value: Draft; indexes: { 'by-user': string } }
  chunks: { key: [string, number, number]; value: ChunkRow; indexes: { 'by-draft': string } }
}

const dbPromise = openDB<DraftsDB>('meetnotes-drafts', 1, {
  upgrade(db) {
    db.createObjectStore('drafts', { keyPath: 'id' }).createIndex('by-user', 'userId')
    db.createObjectStore('chunks', { keyPath: ['draftId', 'seg', 'seq'] }).createIndex('by-draft', 'draftId')
  },
})

/** A draft whose last write is older than this is treated as abandoned (the recorder writes every second). */
export const STALE_AFTER_MS = 20_000
const TOUCH_EVERY_MS = 5_000
const lastTouch = new Map<string, number>()

export async function createDraft(userId: string, mime: string): Promise<string> {
  const id = crypto.randomUUID()
  const now = Date.now()
  await (await dbPromise).put('drafts', { id, userId, mime, startedAt: now, updatedAt: now, segmentSeconds: {} })
  lastTouch.set(id, now)
  return id
}

export async function appendChunk(draftId: string, seg: number, seq: number, blob: Blob): Promise<void> {
  const db = await dbPromise
  await db.put('chunks', { draftId, seg, seq, blob })
  const now = Date.now()
  if (now - (lastTouch.get(draftId) ?? 0) >= TOUCH_EVERY_MS) {
    lastTouch.set(draftId, now)
    const d = await db.get('drafts', draftId)
    if (d) await db.put('drafts', { ...d, updatedAt: now })
  }
}

export async function closeSegment(draftId: string, seg: number, seconds: number): Promise<void> {
  const db = await dbPromise
  const d = await db.get('drafts', draftId)
  if (d) await db.put('drafts', { ...d, updatedAt: Date.now(), segmentSeconds: { ...d.segmentSeconds, [seg]: Math.round(seconds) } })
}

export interface RecoverableDraft {
  draft: Draft
  chunkCount: number
}

/** Drafts for this user that nothing has written to recently, i.e. crashed or abandoned recordings. */
export async function listRecoverable(userId: string, now = Date.now()): Promise<RecoverableDraft[]> {
  const db = await dbPromise
  const out: RecoverableDraft[] = []
  for (const draft of await db.getAllFromIndex('drafts', 'by-user', userId)) {
    if (now - draft.updatedAt < STALE_AFTER_MS) continue
    const chunkCount = await db.countFromIndex('chunks', 'by-draft', draft.id)
    if (chunkCount === 0) {
      await deleteDraft(draft.id) // nothing worth keeping
      continue
    }
    out.push({ draft, chunkCount })
  }
  return out.sort((a, b) => b.draft.startedAt - a.draft.startedAt)
}

export interface RecoveredPart {
  blob: Blob
  durationSeconds: number
}

/** Rebuild the audio segments of a draft. Chunks are ~1 s each, so an unfinished segment's length is its chunk count. */
export async function loadDraftParts(draftId: string): Promise<RecoveredPart[]> {
  const db = await dbPromise
  const draft = await db.get('drafts', draftId)
  if (!draft) return []
  const rows = await db.getAllFromIndex('chunks', 'by-draft', draftId)
  const bySeg = new Map<number, ChunkRow[]>()
  for (const r of rows) bySeg.set(r.seg, [...(bySeg.get(r.seg) ?? []), r])
  return [...bySeg.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seg, chunks]) => ({
      blob: new Blob(
        chunks.sort((a, b) => a.seq - b.seq).map((c) => c.blob),
        { type: draft.mime || 'audio/webm' },
      ),
      durationSeconds: draft.segmentSeconds[seg] ?? chunks.length,
    }))
}

export async function deleteDraft(draftId: string): Promise<void> {
  const db = await dbPromise
  const tx = db.transaction(['drafts', 'chunks'], 'readwrite')
  const keys = await tx.objectStore('chunks').index('by-draft').getAllKeys(draftId)
  await Promise.all(keys.map((k) => tx.objectStore('chunks').delete(k)))
  await tx.objectStore('drafts').delete(draftId)
  await tx.done
  lastTouch.delete(draftId)
}
