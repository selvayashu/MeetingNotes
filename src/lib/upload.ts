import { supabase } from './supabase'
import { extensionFor } from './audio'
import { enqueue, listPending, removePending, type PendingRecording } from './queue'

export type NewRecording = Omit<PendingRecording, 'id' | 'createdAt' | 'meetingDate'>

/** Upload audio, then create the meeting row. Safe to retry: same id, upsert semantics. */
export async function uploadRecording(item: PendingRecording): Promise<void> {
  const ext = extensionFor(item.blob.type, item.fileName)
  const path = `${item.userId}/${item.id}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('recordings')
    .upload(path, item.blob, { contentType: item.blob.type || undefined, upsert: true })
  if (upErr) throw upErr

  const { error } = await supabase.from('meetings').upsert({
    id: item.id,
    user_id: item.userId,
    title: item.title,
    meeting_date: item.meetingDate,
    language: item.language,
    notes_language: item.notesLanguage,
    duration_seconds: item.durationSeconds,
    audio_path: path,
    status: 'uploaded',
  })
  if (error) throw error
}

function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true
  const msg = String((err as { message?: string })?.message ?? err)
  return /failed to fetch|network|load failed/i.test(msg)
}

export type SubmitResult = { id: string; queued: boolean }

/**
 * Save the recording locally first (so nothing is lost on a crash or dropped
 * connection), then try to upload. Offline/network failures leave it queued.
 */
export async function submitRecording(rec: NewRecording): Promise<SubmitResult> {
  const item: PendingRecording = {
    ...rec,
    id: crypto.randomUUID(),
    meetingDate: new Date().toISOString(),
    createdAt: Date.now(),
  }
  await enqueue(item)
  try {
    await uploadRecording(item)
    await removePending(item.id)
    return { id: item.id, queued: false }
  } catch (err) {
    if (isNetworkError(err)) return { id: item.id, queued: true }
    await removePending(item.id)
    throw err
  }
}

let flushing = false

/** Upload everything queued for this user. Returns number uploaded. */
export async function flushQueue(userId: string): Promise<number> {
  if (flushing || !navigator.onLine) return 0
  flushing = true
  let done = 0
  try {
    for (const item of await listPending(userId)) {
      try {
        await uploadRecording(item)
        await removePending(item.id)
        done++
      } catch (err) {
        if (isNetworkError(err)) break // still offline; try again later
        console.error('Queued upload failed permanently', item.id, err)
      }
    }
  } finally {
    flushing = false
  }
  return done
}
