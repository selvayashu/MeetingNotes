import { supabase } from './supabase'
import { extensionFor } from './audio'
import { CONSENT_VERSION } from './consent'
import { enqueue, listPending, removePending, type PendingRecording } from './queue'

export type NewRecording = Omit<PendingRecording, 'id' | 'createdAt' | 'meetingDate' | 'consent'> & { consent: boolean }

/** Upload every part, then create the meeting row. Safe to retry: same id, upsert uploads. */
export async function uploadRecording(item: PendingRecording): Promise<void> {
  const audioParts = []
  for (const [i, part] of item.parts.entries()) {
    const ext = extensionFor(part.blob.type, part.fileName)
    const path = `${item.userId}/${item.id}/${String(i).padStart(3, '0')}.${ext}`
    const { error } = await supabase.storage
      .from('recordings')
      .upload(path, part.blob, { contentType: part.blob.type || undefined, upsert: true })
    if (error) throw error
    audioParts.push({ path, duration_seconds: part.durationSeconds, mime: part.blob.type })
  }

  const total = item.parts.every((p) => p.durationSeconds != null)
    ? item.parts.reduce((s, p) => s + (p.durationSeconds ?? 0), 0)
    : null

  // Users can't UPDATE processing columns (see migration 4), so a retry must be insert-or-ignore.
  const { error } = await supabase.from('meetings').upsert(
    {
      id: item.id,
      user_id: item.userId,
      title: item.title,
      meeting_date: item.meetingDate,
      language: item.language,
      notes_language: item.notesLanguage,
      template: item.template ?? 'general',
      duration_seconds: total,
      audio_path: audioParts[0]?.path ?? null,
      audio_parts: audioParts,
      // The database stamps the time and freezes these; the app only reports whether the box was ticked.
      consent_confirmed: item.consent === true,
      consent_version: item.consent === true ? CONSENT_VERSION : null,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )
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
