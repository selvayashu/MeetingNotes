import type { WhisperSegment } from './whisper'

export interface SegmentRow {
  meeting_id: string
  start_ms: number
  end_ms: number
  text: string
  /** Whisper's own text when `text` was spell-corrected afterwards (Hindi), else null. */
  asr_text: string | null
}

/** Shift part-relative Whisper timestamps (seconds) onto the meeting timeline (ms). */
export function toSegmentRows(
  meetingId: string,
  offsetMs: number,
  segments: WhisperSegment[],
): SegmentRow[] {
  return segments
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length > 0)
    .map((s) => ({
      meeting_id: meetingId,
      start_ms: offsetMs + Math.round(s.start * 1000),
      end_ms: offsetMs + Math.round(Math.max(s.end, s.start) * 1000),
      text: s.text,
      asr_text: null,
    }))
}

/** Where part `index` starts, using real durations of earlier parts (client estimate as fallback). */
export function partOffsetMs(
  parts: { duration_seconds: number | null; actual_ms?: number }[],
  index: number,
): number {
  let ms = 0
  for (let i = 0; i < index; i++) {
    ms += parts[i].actual_ms ?? Math.round((parts[i].duration_seconds ?? 0) * 1000)
  }
  return ms
}
