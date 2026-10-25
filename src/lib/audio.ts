import { parseWavHeader, sliceWav } from './wav'

export const MAX_RECORDING_SECONDS =
  (Number(import.meta.env.VITE_MAX_RECORDING_MINUTES) || 90) * 60

/** In-browser recordings are cut into segments of this length (see useRecorder). */
export const SEGMENT_SECONDS = 300

export const ACCEPTED_AUDIO = '.mp3,.m4a,.wav,.webm,.mp4,.ogg,audio/*'

/** Best container the browser can record: webm/opus on Chrome/Firefox/Android, mp4 on iOS Safari. */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  )
}

export function extensionFor(mime: string, fileName?: string): string {
  const fromName = fileName?.split('.').pop()?.toLowerCase()
  if (fromName && /^(mp3|m4a|wav|webm|mp4|ogg|aac)$/.test(fromName)) return fromName
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

/** Read duration from audio metadata (used for uploaded files). Returns null if unreadable. */
export function readDuration(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const el = new Audio()
    const done = (v: number | null) => {
      URL.revokeObjectURL(url)
      resolve(v)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration) : null)
    el.onerror = () => done(null)
    el.src = url
  })
}

/** Max audio per stored part (keeps one Whisper call small enough for a Worker's memory). */
const PART_MAX_BYTES = 12 * 1024 * 1024

export interface UploadPart {
  blob: Blob
  durationSeconds: number | null
  fileName?: string
}

/** WAV files are cut into Whisper-sized parts; other formats go up as a single part. */
export async function partsFromFile(file: File): Promise<UploadPart[]> {
  if (/\.wav$/i.test(file.name) || file.type.includes('wav')) {
    const info = parseWavHeader(await file.slice(0, 65536).arrayBuffer(), file.size)
    if (info) {
      return sliceWav(file, info, SEGMENT_SECONDS, PART_MAX_BYTES).map((s) => ({
        blob: s.blob,
        durationSeconds: Math.round(s.durationSeconds),
        fileName: 'part.wav',
      }))
    }
  }
  return [{ blob: file, durationSeconds: await readDuration(file), fileName: file.name }]
}

export function formatClock(totalSeconds: number): string {
  const s = Math.floor(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}
