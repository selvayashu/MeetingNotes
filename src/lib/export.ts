import type { ActionItem, Meeting, MeetingNotes, Segment } from './types'

const LANG_NAMES: Record<string, string> = { en: 'English', hi: 'Hindi', ta: 'Tamil', auto: 'Auto-detected' }

export interface ExportData {
  meeting: Pick<Meeting, 'title' | 'meeting_date' | 'language' | 'duration_seconds'>
  notes: MeetingNotes | null
  items: ActionItem[]
  segments: Segment[]
}

export function formatTimestamp(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

function metaLine(m: ExportData['meeting']): string {
  const parts = [m.meeting_date.slice(0, 10), LANG_NAMES[m.language] ?? m.language]
  if (m.duration_seconds != null) parts.push(`${Math.max(1, Math.round(m.duration_seconds / 60))} min`)
  return parts.join(' · ')
}

function itemLine(a: ActionItem): string {
  const bits = [a.owner, a.due_date ? `due ${a.due_date}` : null].filter(Boolean)
  return `${a.task}${bits.length ? ` (${bits.join(', ')})` : ''}`
}

export function buildMarkdown(d: ExportData, opts: { transcript?: boolean } = {}): string {
  const out: string[] = [`# ${d.meeting.title}`, `*${metaLine(d.meeting)}*`]
  if (d.notes?.summary) out.push('## Summary', d.notes.summary)
  if (d.notes?.decisions.length) out.push('## Decisions', d.notes.decisions.map((x) => `- ${x}`).join('\n'))
  if (d.items.length) {
    out.push('## Action items', d.items.map((a) => `- [${a.is_done ? 'x' : ' '}] ${itemLine(a)}`).join('\n'))
  }
  if (opts.transcript && d.segments.length) {
    out.push('## Transcript', d.segments.map((s) => `**[${formatTimestamp(s.start_ms)}]** ${s.text}`).join('\n\n'))
  }
  return out.join('\n\n') + '\n'
}

/** Same content without Markdown syntax, for plain .txt files and chat apps. */
export function buildPlainText(d: ExportData, opts: { transcript?: boolean } = {}): string {
  const out: string[] = [d.meeting.title, metaLine(d.meeting)]
  if (d.notes?.summary) out.push('SUMMARY\n' + d.notes.summary)
  if (d.notes?.decisions.length) out.push('DECISIONS\n' + d.notes.decisions.map((x) => `- ${x}`).join('\n'))
  if (d.items.length) {
    out.push('ACTION ITEMS\n' + d.items.map((a) => `[${a.is_done ? 'x' : ' '}] ${itemLine(a)}`).join('\n'))
  }
  if (opts.transcript && d.segments.length) {
    out.push('TRANSCRIPT\n' + d.segments.map((s) => `[${formatTimestamp(s.start_ms)}] ${s.text}`).join('\n'))
  }
  return out.join('\n\n') + '\n'
}

/** Filesystem-safe name that keeps Devanagari/Tamil letters. */
export function fileSlug(title: string): string {
  const s = title.trim().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return (s || 'meeting').slice(0, 60)
}
