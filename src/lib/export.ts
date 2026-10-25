import type { ActionItem, Meeting, MeetingNotes, Segment } from './types'

export interface ExportLabels {
  summary: string
  decisions: string
  actions: string
  transcript: string
  due: (date: string) => string
  minutes: (n: number) => string
  lang: (code: string) => string
}

export const EN_LABELS: ExportLabels = {
  summary: 'Summary',
  decisions: 'Decisions',
  actions: 'Action items',
  transcript: 'Transcript',
  due: (d) => `due ${d}`,
  minutes: (n) => `${n} min`,
  lang: (c) => ({ en: 'English', hi: 'Hindi', ta: 'Tamil', auto: 'Auto-detected' })[c] ?? c,
}

export interface ExportData {
  meeting: Pick<Meeting, 'title' | 'meeting_date' | 'language' | 'duration_seconds'>
  notes: MeetingNotes | null
  items: ActionItem[]
  segments: Segment[]
}

interface Opts {
  transcript?: boolean
  labels?: ExportLabels
}

export function formatTimestamp(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

function metaLine(m: ExportData['meeting'], L: ExportLabels): string {
  const parts = [m.meeting_date.slice(0, 10), L.lang(m.language)]
  if (m.duration_seconds != null) parts.push(L.minutes(Math.max(1, Math.round(m.duration_seconds / 60))))
  return parts.join(' · ')
}

function itemLine(a: ActionItem, L: ExportLabels): string {
  const bits = [a.owner, a.due_date ? L.due(a.due_date) : null].filter(Boolean)
  return `${a.task}${bits.length ? ` (${bits.join(', ')})` : ''}`
}

export function buildMarkdown(d: ExportData, opts: Opts = {}): string {
  const L = opts.labels ?? EN_LABELS
  const out: string[] = [`# ${d.meeting.title}`, `*${metaLine(d.meeting, L)}*`]
  if (d.notes?.summary) out.push(`## ${L.summary}`, d.notes.summary)
  if (d.notes?.decisions.length) out.push(`## ${L.decisions}`, d.notes.decisions.map((x) => `- ${x}`).join('\n'))
  if (d.items.length) {
    out.push(`## ${L.actions}`, d.items.map((a) => `- [${a.is_done ? 'x' : ' '}] ${itemLine(a, L)}`).join('\n'))
  }
  if (opts.transcript && d.segments.length) {
    out.push(`## ${L.transcript}`, d.segments.map((s) => `**[${formatTimestamp(s.start_ms)}]** ${s.text}`).join('\n\n'))
  }
  return out.join('\n\n') + '\n'
}

/** Same content without Markdown syntax, for plain .txt files and chat apps. */
export function buildPlainText(d: ExportData, opts: Opts = {}): string {
  const L = opts.labels ?? EN_LABELS
  const H = (s: string) => s.toLocaleUpperCase()
  const out: string[] = [d.meeting.title, metaLine(d.meeting, L)]
  if (d.notes?.summary) out.push(`${H(L.summary)}\n${d.notes.summary}`)
  if (d.notes?.decisions.length) out.push(`${H(L.decisions)}\n` + d.notes.decisions.map((x) => `- ${x}`).join('\n'))
  if (d.items.length) {
    out.push(`${H(L.actions)}\n` + d.items.map((a) => `[${a.is_done ? 'x' : ' '}] ${itemLine(a, L)}`).join('\n'))
  }
  if (opts.transcript && d.segments.length) {
    out.push(`${H(L.transcript)}\n` + d.segments.map((s) => `[${formatTimestamp(s.start_ms)}] ${s.text}`).join('\n'))
  }
  return out.join('\n\n') + '\n'
}

/** Filesystem-safe name that keeps Devanagari/Tamil letters (and their vowel signs). */
export function fileSlug(title: string): string {
  const s = title.trim().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return (s || 'meeting').slice(0, 60)
}
