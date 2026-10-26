import { buildMarkdown, fileSlug, type ExportData } from './export'
import { supabase } from './supabase'
import type { ActionItem, Meeting, MeetingNotes, Segment } from './types'
import { makeZip, type ZipEntry } from './zip'

export interface Profile {
  full_name: string | null
  preferred_language: string
  delete_audio_after_notes: boolean
  created_at: string
}

export interface AllData {
  email: string
  exportedAt: string
  profile: Profile | null
  meetings: Meeting[]
  notes: Record<string, MeetingNotes>
  items: Record<string, ActionItem[]>
  segments: Record<string, Segment[]>
}

export interface AudioFile {
  /** Path inside the archive, e.g. audio/<meeting>/000.wav */
  name: string
  data: Blob
}

const PAGE = 1000

/** Read a whole table in pages (the API returns at most 1,000 rows per request). */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

const group = <T extends { meeting_id: string }>(rows: T[]) => {
  const out: Record<string, T[]> = {}
  for (const r of rows) (out[r.meeting_id] ??= []).push(r)
  return out
}

/** Everything the signed-in user owns, as the database returns it under their own access rules. */
export async function fetchAllData(userId: string, email: string): Promise<AllData> {
  const [profile, meetings, notes, items, segments] = await Promise.all([
    supabase.from('profiles').select('full_name,preferred_language,delete_audio_after_notes,created_at').eq('id', userId).maybeSingle(),
    readAll<Meeting>((a, b) => supabase.from('meetings').select('*').order('meeting_date', { ascending: false }).order('id').range(a, b)),
    readAll<MeetingNotes & { meeting_id: string }>((a, b) =>
      supabase.from('meeting_notes').select('meeting_id,summary,decisions,generated_at').order('meeting_id').range(a, b),
    ),
    readAll<ActionItem & { meeting_id: string }>((a, b) =>
      supabase.from('action_items').select('id,meeting_id,task,owner,due_date,is_done').order('id').range(a, b),
    ),
    readAll<Segment & { meeting_id: string }>((a, b) =>
      supabase
        .from('transcript_segments')
        .select('id,meeting_id,start_ms,end_ms,text,original_text,edited_at')
        .order('meeting_id')
        .order('start_ms')
        .order('id')
        .range(a, b),
    ),
  ])
  if (profile.error) throw new Error(profile.error.message)
  return {
    email,
    exportedAt: new Date().toISOString(),
    profile: (profile.data as Profile | null) ?? null,
    meetings,
    notes: Object.fromEntries(notes.map((n) => [n.meeting_id, n])),
    items: group(items),
    segments: group(segments),
  }
}

/** Download every audio part of the user's meetings (can be large). Files that can't be fetched are reported, not fatal. */
export async function fetchAudio(
  meetings: Meeting[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ files: AudioFile[]; missing: string[] }> {
  const jobs = meetings.flatMap((m) => {
    const paths = m.audio_parts?.length ? m.audio_parts.map((p) => p.path) : m.audio_path ? [m.audio_path] : []
    return paths.map((path, i) => ({ path, name: `audio/${m.id}/${String(i).padStart(3, '0')}${path.match(/\.[A-Za-z0-9]+$/)?.[0] ?? ''}` }))
  })
  const files: AudioFile[] = []
  const missing: string[] = []
  let done = 0
  for (const j of jobs) {
    const { data, error } = await supabase.storage.from('recordings').download(j.path)
    if (error || !data) missing.push(j.name)
    else files.push({ name: j.name, data })
    onProgress?.(++done, jobs.length)
  }
  return { files, missing }
}

const README = (d: AllData, withAudio: boolean, missing: string[]) =>
  [
    'MeetNotes data export',
    `Account: ${d.email}`,
    `Exported: ${d.exportedAt}`,
    `Meetings: ${d.meetings.length}`,
    '',
    'meetings.json  everything in one machine-readable file (meetings, notes, action items, transcripts, your settings).',
    'meetings/      one readable Markdown file per meeting (summary, decisions, action items, transcript).',
    withAudio
      ? 'audio/         the original recordings, in folders named by meeting id (see meetings.json).'
      : 'Audio recordings are not included in this export.',
    missing.length ? `\nThese audio files could not be downloaded and are missing: ${missing.join(', ')}` : '',
    '',
    'The AI-written notes can contain mistakes.',
  ].join('\n')

/** Pure: turn the fetched data (and optional audio) into the archive. */
export async function buildArchive(d: AllData, audio: { files: AudioFile[]; missing: string[] } | null): Promise<Blob> {
  const entries: ZipEntry[] = []
  const enc = new TextEncoder()
  const used = new Set<string>()
  const json = {
    exported_at: d.exportedAt,
    account: { email: d.email, ...d.profile },
    meetings: d.meetings.map((m) => ({
      ...m,
      notes: d.notes[m.id]
        ? { summary: d.notes[m.id].summary, decisions: d.notes[m.id].decisions, generated_at: d.notes[m.id].generated_at }
        : null,
      action_items: (d.items[m.id] ?? []).map(({ id: _id, ...a }) => a),
      transcript: (d.segments[m.id] ?? []).map(({ id: _id, ...s }) => s),
    })),
  }
  entries.push({ name: 'README.txt', data: enc.encode(README(d, audio !== null, audio?.missing ?? [])) })
  entries.push({ name: 'meetings.json', data: enc.encode(JSON.stringify(json, null, 2)) })

  for (const m of d.meetings) {
    const data: ExportData = { meeting: m, notes: d.notes[m.id] ?? null, items: d.items[m.id] ?? [], segments: d.segments[m.id] ?? [] }
    let name = `meetings/${m.meeting_date.slice(0, 10)}-${fileSlug(m.title)}`
    if (used.has(name)) name += `-${m.id.slice(0, 8)}`
    used.add(name)
    entries.push({ name: `${name}.md`, data: enc.encode(buildMarkdown(data, { transcript: true })) })
  }
  for (const f of audio?.files ?? []) entries.push({ name: f.name, data: f.data })
  return makeZip(entries)
}

export async function exportAllData(
  userId: string,
  email: string,
  opts: { includeAudio: boolean; onProgress?: (done: number, total: number) => void },
): Promise<{ blob: Blob; filename: string; meetings: number; missingAudio: number }> {
  const data = await fetchAllData(userId, email)
  const audio = opts.includeAudio ? await fetchAudio(data.meetings, opts.onProgress) : null
  const blob = await buildArchive(data, audio)
  return {
    blob,
    filename: `meetnotes-export-${data.exportedAt.slice(0, 10)}.zip`,
    meetings: data.meetings.length,
    missingAudio: audio?.missing.length ?? 0,
  }
}

/** Remove everything MeetNotes keeps on this device: queued uploads, crash-recovery drafts, preferences. */
export async function clearLocalData(): Promise<void> {
  try {
    for (const name of ['meetnotes-queue', 'meetnotes-drafts']) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name)
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      })
    }
  } catch {
    /* no IndexedDB */
  }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('meetnotes.')) localStorage.removeItem(k)
  } catch {
    /* storage blocked */
  }
}
