import type { SupabaseClient } from '@supabase/supabase-js'
import type { Env, MeetingRow } from './env'
import {
  CHUNK_CHARS,
  DEFAULT_LLM,
  chunkTranscript,
  resolveDueDate,
  summariseStep,
  type Notes,
  type NotesOptions,
  type SummaryState,
} from './notes'

export interface StageProgress {
  done: boolean
  processed: number
  total: number
}

async function loadTranscriptTexts(db: SupabaseClient, meetingId: string): Promise<string[]> {
  const texts: string[] = []
  // PostgREST returns at most 1000 rows per request.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('transcript_segments')
      .select('text')
      .eq('meeting_id', meetingId)
      .order('start_ms', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    texts.push(...data.map((r) => r.text as string))
    if (data.length < 1000) break
  }
  return texts
}

function outputLanguage(m: MeetingRow): NotesOptions['outLang'] {
  if (m.notes_language === 'en') return 'en'
  if (m.notes_language === 'hi' || m.notes_language === 'ta') return m.notes_language
  // "same as meeting": use the declared language if there is one.
  return m.language === 'auto' ? 'same' : m.language
}

async function finish(db: SupabaseClient, env: Env, m: MeetingRow, notes: Notes, state: SummaryState | null) {
  const { error: nErr } = await db.from('meeting_notes').upsert(
    {
      meeting_id: m.id,
      summary: notes.summary,
      decisions: notes.decisions,
      raw_llm_output: { ...(state ?? {}), final: notes },
    },
    { onConflict: 'meeting_id' },
  )
  if (nErr) throw nErr

  // Replace (not append) so a re-run never duplicates items.
  await db.from('action_items').delete().eq('meeting_id', m.id)
  if (notes.action_items.length > 0) {
    const { error } = await db.from('action_items').insert(
      notes.action_items.map((a) => ({
        meeting_id: m.id,
        task: a.task,
        owner: a.owner,
        due_date: resolveDueDate(a.due_date, m.meeting_date),
      })),
    )
    if (error) throw error
  }

  // Optional privacy/storage setting: drop the audio once the notes exist.
  const { data: profile } = await db
    .from('profiles')
    .select('delete_audio_after_notes')
    .eq('id', m.user_id)
    .maybeSingle()
  let audioPatch: Record<string, unknown> = {}
  if (profile?.delete_audio_after_notes) {
    const paths = m.audio_parts.map((p) => p.path)
    const { error } = await db.storage.from('recordings').remove(paths)
    if (!error) audioPatch = { audio_path: null, audio_parts: [] }
  }

  await db
    .from('meetings')
    .update({ status: 'done', error_message: null, lock_until: null, ...audioPatch })
    .eq('id', m.id)
}

/** Summarise as much as fits before `deadline`; marks the meeting done when finished. */
export async function runSummaryStage(args: {
  db: SupabaseClient
  env: Env
  meeting: MeetingRow
  deadline: number
}): Promise<StageProgress> {
  const { db, env, meeting, deadline } = args
  const model = env.LLM_MODEL || DEFAULT_LLM

  const chunks = chunkTranscript(await loadTranscriptTexts(db, meeting.id), CHUNK_CHARS)
  if (chunks.length === 0) {
    // Silence or unintelligible audio: finish with an honest empty result.
    await finish(db, env, meeting, { summary: 'No speech was detected in this recording.', decisions: [], action_items: [] }, null)
    return { done: true, processed: 0, total: 0 }
  }

  const { data: existing } = await db
    .from('meeting_notes')
    .select('raw_llm_output')
    .eq('meeting_id', meeting.id)
    .maybeSingle()

  const result = await summariseStep({
    ai: env.AI,
    model,
    chunks,
    state: (existing?.raw_llm_output as SummaryState | null) ?? null,
    options: { outLang: outputLanguage(meeting), meetingDateIso: meeting.meeting_date },
    deadline,
    save: async (state) => {
      const { error } = await db
        .from('meeting_notes')
        .upsert({ meeting_id: meeting.id, raw_llm_output: state }, { onConflict: 'meeting_id' })
      if (error) throw error
    },
  })

  if (result.done && result.notes) await finish(db, env, meeting, result.notes, result.state)
  return { done: result.done, processed: result.processed, total: result.total }
}
