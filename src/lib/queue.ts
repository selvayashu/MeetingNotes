import { openDB, type DBSchema } from 'idb'

export interface PendingRecording {
  /** Also used as the meetings.id, so retries are idempotent. */
  id: string
  userId: string
  /** One entry per self-contained audio segment, in order. */
  parts: { blob: Blob; durationSeconds: number | null; fileName?: string }[]
  title: string
  /** The person recording confirmed everyone heard was told and agrees (absent on items queued before this existed). */
  consent?: boolean
  language: 'en' | 'hi' | 'ta' | 'auto'
  notesLanguage: 'en' | 'hi' | 'ta' | 'auto'
  meetingDate: string
  createdAt: number
}

interface QueueDB extends DBSchema {
  pending: { key: string; value: PendingRecording; indexes: { 'by-user': string } }
}

const dbPromise = openDB<QueueDB>('meetnotes-queue', 1, {
  upgrade(db) {
    db.createObjectStore('pending', { keyPath: 'id' }).createIndex('by-user', 'userId')
  },
})

export async function enqueue(item: PendingRecording) {
  await (await dbPromise).put('pending', item)
}

export async function listPending(userId: string): Promise<PendingRecording[]> {
  return (await dbPromise).getAllFromIndex('pending', 'by-user', userId)
}

export async function removePending(id: string) {
  await (await dbPromise).delete('pending', id)
}
