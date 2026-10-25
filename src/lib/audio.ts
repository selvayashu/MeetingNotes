export const MAX_RECORDING_SECONDS =
  (Number(import.meta.env.VITE_MAX_RECORDING_MINUTES) || 90) * 60

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

export function formatClock(totalSeconds: number): string {
  const s = Math.floor(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}
