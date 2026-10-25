import type { Segment } from './types'

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive, literal (no regex syntax) replace of every occurrence. `$&`-style tokens in `to` stay literal. */
export function replaceInText(text: string, find: string, to: string): string {
  if (!find) return text
  return text.replace(new RegExp(escapeRegExp(find), 'giu'), () => to)
}

export interface PlannedEdit {
  id: string
  text: string
}

/**
 * Which lines would change if every `find` became `to`. Lines that would end up empty are left out (the database
 * refuses empty lines) and counted as `skipped` so the user is told.
 */
export function planReplace(segments: Pick<Segment, 'id' | 'text'>[], find: string, to: string) {
  const edits: PlannedEdit[] = []
  let skipped = 0
  if (!find) return { edits, skipped }
  for (const s of segments) {
    const next = replaceInText(s.text, find, to).trim()
    if (next === s.text) continue
    if (next === '') skipped++
    else edits.push({ id: s.id, text: next })
  }
  return { edits, skipped }
}

/** True when any edit is newer than the notes, i.e. the summary/decisions/action items no longer match the transcript. */
export function notesAreStale(
  segments: Pick<Segment, 'edited_at'>[],
  generatedAt: string | null | undefined,
): boolean {
  if (!generatedAt) return false
  const gen = Date.parse(generatedAt)
  return segments.some((s) => s.edited_at != null && Date.parse(s.edited_at) > gen)
}
