import type { AudioPart } from './types'

export interface PartTiming {
  startMs: number
  durationMs: number
}

/** Place each audio part on the meeting timeline. Same rule the server used to offset segments. */
export function buildTimeline(parts: Pick<AudioPart, 'duration_seconds' | 'actual_ms'>[]): PartTiming[] {
  let start = 0
  return parts.map((p) => {
    const durationMs = p.actual_ms ?? Math.round((p.duration_seconds ?? 0) * 1000)
    const t = { startMs: start, durationMs }
    start += durationMs
    return t
  })
}

export function totalMs(timeline: PartTiming[]): number {
  const last = timeline.at(-1)
  return last ? last.startMs + last.durationMs : 0
}

/** Which part holds `ms`, and where inside it. Out-of-range values clamp to the ends. */
export function locate(timeline: PartTiming[], ms: number): { index: number; offsetMs: number } {
  if (timeline.length === 0) return { index: 0, offsetMs: 0 }
  const t = Math.max(0, ms)
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (t >= timeline[i].startMs) {
      return { index: i, offsetMs: Math.min(t - timeline[i].startMs, Math.max(timeline[i].durationMs, 0)) }
    }
  }
  return { index: 0, offsetMs: 0 }
}

/** Index of the last segment starting at or before `ms`, or -1. Segments must be sorted by start. */
export function activeSegmentIndex(segments: { start_ms: number }[], ms: number): number {
  let lo = 0
  let hi = segments.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid].start_ms <= ms) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}
