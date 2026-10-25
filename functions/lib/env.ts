export interface Env {
  AI: Ai
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  /** Max meetings a user may start processing per UTC day. */
  MAX_MEETINGS_PER_DAY?: string
  /** Max recording length in minutes. */
  MAX_RECORDING_MINUTES?: string
  /** Override the notes LLM (default: Llama 3.3 70B fp8-fast). */
  LLM_MODEL?: string
  /** Shared secret the Supabase scheduler sends in x-cron-secret. Unset disables background processing. */
  CRON_SECRET?: string
}

export interface AudioPart {
  path: string
  duration_seconds: number | null
  mime?: string
  /** Real duration reported by Whisper, written back after the part is transcribed. */
  actual_ms?: number
}

export interface MeetingRow {
  id: string
  user_id: string
  language: 'en' | 'hi' | 'ta' | 'auto'
  notes_language: 'en' | 'hi' | 'ta' | 'auto'
  meeting_date: string
  status: 'uploaded' | 'transcribing' | 'summarising' | 'done' | 'failed'
  audio_parts: AudioPart[]
  processed_parts: number
  processing_started_at: string | null
}
