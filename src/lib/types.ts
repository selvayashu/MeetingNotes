export interface AudioPart {
  path: string
  duration_seconds: number | null
  mime?: string
  /** Real duration reported by Whisper; written by the server after transcription. */
  actual_ms?: number
}

export type MeetingStatus = 'uploaded' | 'transcribing' | 'summarising' | 'done' | 'failed'
export type Lang = 'en' | 'hi' | 'ta' | 'auto'

export interface Meeting {
  id: string
  title: string
  meeting_date: string
  language: Lang
  notes_language: Lang
  duration_seconds: number | null
  status: MeetingStatus
  error_message: string | null
  audio_path: string | null
  audio_parts: AudioPart[]
  processed_parts: number
}

export interface MeetingNotes {
  summary: string
  decisions: string[]
}

export interface ActionItem {
  id: string
  task: string
  owner: string | null
  due_date: string | null
  is_done: boolean
}

export interface Segment {
  id: string
  start_ms: number
  end_ms: number
  text: string
}
