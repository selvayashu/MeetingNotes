import Dexie, { type EntityTable } from 'dexie';
import type { OutputLanguage, TranscriptionMode } from './languages';

export type MeetingStatus =
  | 'recording' // capture in progress
  | 'queued' // needs (re-)transcription of the full audio; waits for the server when offline
  | 'transcribing'
  | 'transcribed' // transcript ready, notes not requested
  | 'needs_notes' // waits for the server to generate notes
  | 'summarizing'
  | 'ready'
  | 'failed';

export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  lang?: string;
}

export interface ActionItem {
  owner: string;
  task: string;
  due_date: string;
  done?: boolean;
}

export interface Notes {
  summary: string;
  key_points: string[];
  decisions: string[];
  action_items: ActionItem[];
  open_questions: string[];
  model?: string;
  outputLanguage?: OutputLanguage;
  generatedAt?: number;
}

export interface Bookmark {
  id: string;
  time: number; // seconds from start
  label: string;
}

export interface Meeting {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  languageMode: TranscriptionMode;
  detectedLanguage?: string;
  tags: string[];
  segments: Segment[];
  transcriptOverride?: string; // user-edited transcript text
  notes?: Notes;
  manualNotes: string;
  bookmarks: Bookmark[];
  status: MeetingStatus;
  failedStep?: 'transcribe' | 'notes';
  error?: string;
  warning?: string;
  hasAudio: boolean;
  audioMime?: string;
  transcribedBy?: string;
}

export interface AudioRecord {
  meetingId: string;
  blob: Blob;
  mimeType: string;
}

/** Audio written every few seconds while recording, so a crash or closed tab loses almost nothing. */
export interface AudioPart {
  id?: number;
  meetingId: string;
  seq: number;
  blob: Blob;
  mimeType: string;
  elapsedMs: number;
}

export const db = new Dexie('meetnotes') as Dexie & {
  meetings: EntityTable<Meeting, 'id'>;
  audio: EntityTable<AudioRecord, 'meetingId'>;
  audioParts: EntityTable<AudioPart, 'id'>;
};

db.version(1).stores({
  meetings: 'id, createdAt, status, *tags',
  audio: 'meetingId',
  audioParts: '++id, meetingId',
});

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Transcript text used for notes and export: the user's edit if any, else the segments. */
export function transcriptText(meeting: Meeting, withTimes = false): string {
  if (meeting.transcriptOverride !== undefined) return meeting.transcriptOverride;
  return meeting.segments
    .map((s) => {
      const who = s.speaker ? `${s.speaker}: ` : '';
      return withTimes ? `[${formatClock(s.start)}] ${who}${s.text}` : `${who}${s.text}`;
    })
    .join('\n');
}

export async function deleteMeeting(id: string): Promise<void> {
  await db.transaction('rw', db.meetings, db.audio, db.audioParts, async () => {
    await db.meetings.delete(id);
    await db.audio.delete(id);
    await db.audioParts.where('meetingId').equals(id).delete();
  });
}

export async function deleteAudio(id: string): Promise<void> {
  await db.transaction('rw', db.meetings, db.audio, async () => {
    await db.audio.delete(id);
    await db.meetings.update(id, { hasAudio: false, updatedAt: Date.now() });
  });
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
