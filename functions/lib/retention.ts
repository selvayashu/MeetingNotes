import type { SupabaseClient } from '@supabase/supabase-js'

export interface ExpiredMeeting {
  id: string
  user_id: string
  audio_parts: { path?: unknown }[] | null
}

export interface SweepResult {
  meetings: number
  files: number
  skipped: number
}

/**
 * Only paths inside the owner's own folder may be removed. audio_parts is written by the client, so a tampered
 * row must never be able to point this job at someone else's recordings.
 */
export function ownPaths(m: ExpiredMeeting): string[] {
  return (m.audio_parts ?? [])
    .map((p) => p.path)
    .filter((p): p is string => typeof p === 'string' && p.startsWith(`${m.user_id}/`) && !p.includes('..'))
}

/**
 * Delete the audio of meetings past their owner's retention period. The meeting row is only cleared after its files
 * were removed, so a storage failure just means "try again tomorrow". Transcripts and notes are untouched.
 */
export async function sweepExpiredAudio(db: SupabaseClient, limit = 100): Promise<SweepResult> {
  const { data, error } = await db.rpc('audio_expired', { max_rows: limit })
  if (error) throw new Error(`audio_expired failed: ${error.message}`)
  const result: SweepResult = { meetings: 0, files: 0, skipped: 0 }

  for (const m of (data ?? []) as ExpiredMeeting[]) {
    const paths = ownPaths(m)
    if (paths.length > 0) {
      const { error: rmErr } = await db.storage.from('recordings').remove(paths)
      if (rmErr) {
        result.skipped++
        continue
      }
    }
    // Clear the row even when no valid path was left (nothing legitimate to delete, nothing legitimate to keep).
    const { error: upErr } = await db.from('meetings').update({ audio_parts: [], audio_path: null }).eq('id', m.id)
    if (upErr) {
      result.skipped++
      continue
    }
    result.meetings++
    result.files += paths.length
  }
  return result
}
