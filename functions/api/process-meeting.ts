import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Env, MeetingRow } from '../lib/env'
import { partOffsetMs, toSegmentRows } from '../lib/segments'
import { runSummaryStage } from '../lib/summaryStage'
import { transcribe } from '../lib/whisper'

/**
 * POST /api/process-meeting  { meetingId }
 *
 * Processing is incremental: each call transcribes as many audio parts as fit in
 * TIME_BUDGET_MS, saves progress, and returns { done, processed, total }. The client calls it
 * again until done. A retry after failure resumes from the first untranscribed part.
 */

const TIME_BUDGET_MS = 35_000
const LOCK_SECONDS = 120
const MAX_PART_BYTES = 16 * 1024 * 1024
const MAX_PARTS = 200

const json = (body: unknown, status = 200) => Response.json(body, { status })

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Verify the caller's Supabase JWT with the Auth server; returns the user id. */
async function authenticate(request: Request, env: Env): Promise<string> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Missing Authorization header')
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new HttpError(401, 'Invalid or expired session')
  const user = (await res.json()) as { id?: string }
  if (!user.id) throw new HttpError(401, 'Invalid session')
  return user.id
}

async function checkRateLimit(db: SupabaseClient, userId: string, env: Env) {
  const limit = Number(env.MAX_MEETINGS_PER_DAY) || 10
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const { count, error } = await db
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('processing_started_at', dayStart.toISOString())
  if (error) throw error
  if ((count ?? 0) >= limit) {
    throw new HttpError(429, `Daily limit of ${limit} processed meetings reached. Try again tomorrow.`)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const started = Date.now()
  let db: SupabaseClient | undefined
  let meetingId: string | undefined
  let locked = false

  try {
    const userId = await authenticate(request, env)
    const body = (await request.json().catch(() => null)) as { meetingId?: string } | null
    meetingId = body?.meetingId
    if (!meetingId || !/^[0-9a-f-]{36}$/i.test(meetingId)) throw new HttpError(400, 'meetingId required')

    db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    const { data: m } = await db.from('meetings').select('*').eq('id', meetingId).maybeSingle()
    // Same response for "missing" and "not yours" so ids can't be probed.
    if (!m || m.user_id !== userId) throw new HttpError(404, 'Meeting not found')
    const meeting = m as MeetingRow

    if (meeting.status === 'done') {
      return json({ done: true, stage: 'done', status: 'done', processed: 1, total: 1 })
    }

    const parts = meeting.audio_parts
    const maxSeconds = (Number(env.MAX_RECORDING_MINUTES) || 90) * 60
    const knownTotal = parts.reduce((s, p) => s + (p.duration_seconds ?? 0), 0)
    if (parts.length === 0) throw new HttpError(422, 'Meeting has no audio')
    if (parts.length > MAX_PARTS || knownTotal > maxSeconds + 60) {
      throw new HttpError(422, `Recording exceeds the ${maxSeconds / 60}-minute limit`)
    }
    // audio_parts is client-supplied: never read a path outside the caller's own folder.
    if (!parts.every((p) => p.path.startsWith(`${userId}/`) && !p.path.includes('..'))) {
      throw new HttpError(403, 'Invalid audio path')
    }

    // Rate limit counts a meeting once, when processing first starts.
    if (!meeting.processing_started_at) await checkRateLimit(db, userId, env)

    // Atomic claim: only one worker per meeting at a time.
    const now = new Date()
    // Resume at the right stage (a retry after a summarising failure skips transcription).
    const transcribed = meeting.processed_parts >= parts.length
    const { data: claimed } = await db
      .from('meetings')
      .update({
        status: transcribed ? 'summarising' : 'transcribing',
        error_message: null,
        processing_started_at: meeting.processing_started_at ?? now.toISOString(),
        lock_until: new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString(),
      })
      .eq('id', meetingId)
      .or(`lock_until.is.null,lock_until.lt.${now.toISOString()}`)
      .select('id')
    if (!claimed?.length) {
      return json(
        { done: false, busy: true, stage: meeting.status, status: meeting.status, processed: meeting.processed_parts, total: parts.length },
        202,
      )
    }
    locked = true

    let processed = meeting.processed_parts
    const workingParts = parts.map((p) => ({ ...p }))

    while (processed < parts.length && (processed === meeting.processed_parts || Date.now() - started < TIME_BUDGET_MS)) {
      const part = workingParts[processed]
      const { data: file, error: dlErr } = await db.storage.from('recordings').download(part.path)
      if (dlErr || !file) throw new Error(`Could not read audio part ${processed + 1}`)
      if (file.size > MAX_PART_BYTES) {
        throw new HttpError(422, `Audio part ${processed + 1} is too large to transcribe (${Math.round(file.size / 1e6)} MB). Upload WAV or a shorter file.`)
      }

      const result = await transcribe(env.AI, await file.arrayBuffer(), meeting.language)
      const offsetMs = partOffsetMs(workingParts, processed)
      part.actual_ms = Math.round(result.durationSeconds * 1000) || undefined

      // Re-running a part (after a crash) must not duplicate its segments.
      await db.from('transcript_segments').delete().eq('meeting_id', meetingId).gte('start_ms', offsetMs)
      const rows = toSegmentRows(meetingId, offsetMs, result.segments)
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('transcript_segments').insert(rows.slice(i, i + 500))
        if (error) throw error
      }

      processed++
      await db
        .from('meetings')
        .update({
          processed_parts: processed,
          audio_parts: workingParts,
          lock_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString(),
        })
        .eq('id', meetingId)
    }

    if (processed < parts.length) {
      await db.from('meetings').update({ status: 'transcribing', lock_until: null }).eq('id', meetingId)
      locked = false
      return json({ done: false, stage: 'transcribing', status: 'transcribing', processed, total: parts.length })
    }

    // Transcription finished: move on to notes. Skip if too little budget is left for an LLM call;
    // the client's next call picks it up.
    await db.from('meetings').update({ status: 'summarising' }).eq('id', meetingId)
    if (Date.now() - started > TIME_BUDGET_MS - 8_000) {
      await db.from('meetings').update({ lock_until: null }).eq('id', meetingId)
      locked = false
      return json({ done: false, stage: 'summarising', status: 'summarising', processed: 0, total: 1 })
    }

    const summary = await runSummaryStage({
      db,
      env,
      meeting: { ...meeting, audio_parts: workingParts },
      deadline: started + TIME_BUDGET_MS,
    })
    if (!summary.done) {
      await db.from('meetings').update({ lock_until: null }).eq('id', meetingId)
    }
    locked = false
    return json({
      done: summary.done,
      stage: summary.done ? 'done' : 'summarising',
      status: summary.done ? 'done' : 'summarising',
      processed: summary.processed,
      total: summary.total,
    })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Processing failed'
    if (status === 500) console.error('process-meeting error', err)

    // Auth / validation / rate-limit rejections leave the meeting untouched.
    if (db && meetingId && (locked || status === 500 || status === 422)) {
      await db
        .from('meetings')
        .update({ status: 'failed', error_message: message.slice(0, 500), lock_until: null })
        .eq('id', meetingId)
    }
    return json({ error: message }, status)
  }
}
