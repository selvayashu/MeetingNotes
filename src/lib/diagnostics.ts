import { pickRecorderMime } from './audio'
import { getRecognitionCtor } from './liveCaptions'

declare const __COMMIT__: string | undefined
declare const __BUILT__: string | undefined

export type DiagRow = { label: string; value: string }

const yn = (v: unknown) => (v ? 'yes' : 'no')

async function permission(name: string): Promise<string> {
  try {
    const p = await navigator.permissions.query({ name: name as PermissionName })
    return p.state
  } catch {
    return 'unknown (not reported by this browser)'
  }
}

/** What this browser and device can do, for pasting into a bug report. Never throws; nothing leaves the device. */
export async function collectDiagnostics(): Promise<DiagRow[]> {
  const w = typeof window !== 'undefined' ? window : undefined
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const standalone = !!w?.matchMedia?.('(display-mode: standalone)').matches || (nav as { standalone?: boolean } | undefined)?.standalone === true

  let storage = 'unknown'
  try {
    const est = await nav?.storage?.estimate?.()
    const persisted = await nav?.storage?.persisted?.()
    storage = `${est?.usage != null ? Math.round(est.usage / 1e6) : '?'} MB used of ${est?.quota != null ? Math.round(est.quota / 1e6) : '?'} MB; kept safe from eviction: ${yn(persisted)}`
  } catch {
    /* not available */
  }

  let sw = 'not supported'
  if (nav && 'serviceWorker' in nav) {
    try {
      const reg = await nav.serviceWorker.getRegistration()
      sw = reg ? `registered (${reg.active ? 'active' : 'not active yet'}${nav.serviceWorker.controller ? ', controlling this page' : ', not controlling this page yet'})` : 'not registered'
    } catch {
      sw = 'error reading'
    }
  }

  let idb = 'no'
  try {
    idb = yn(typeof indexedDB !== 'undefined' && indexedDB !== null)
  } catch {
    idb = 'blocked'
  }

  return [
    { label: 'App version', value: `${typeof __COMMIT__ === 'string' ? __COMMIT__ : 'dev'}, built ${typeof __BUILT__ === 'string' ? __BUILT__ : 'unknown'}` },
    { label: 'Browser', value: nav?.userAgent ?? 'unknown' },
    { label: 'Installed app (standalone)', value: yn(standalone) },
    { label: 'Secure page (https)', value: yn(w?.isSecureContext) },
    { label: 'Online', value: yn(nav?.onLine) },
    { label: 'Screen', value: w ? `${w.innerWidth}x${w.innerHeight} px, pixel ratio ${w.devicePixelRatio}, touch points ${nav?.maxTouchPoints ?? 0}` : 'unknown' },
    { label: 'Language / time zone', value: `${nav?.language ?? '?'} / ${Intl.DateTimeFormat().resolvedOptions().timeZone}` },
    { label: 'Microphone permission', value: await permission('microphone') },
    { label: 'Can record audio (MediaRecorder)', value: yn(typeof MediaRecorder !== 'undefined') },
    { label: 'Recording format used', value: pickRecorderMime() ?? 'none supported' },
    { label: 'Keeps the screen awake while recording', value: yn(nav && 'wakeLock' in nav) },
    { label: 'Live captions (speech recognition)', value: yn(w && getRecognitionCtor(w)) },
    { label: 'Local storage for crash recovery (IndexedDB)', value: idb },
    { label: 'Storage', value: storage },
    { label: 'Offline support (service worker)', value: sw },
    { label: 'Share sheet', value: yn(nav && 'share' in nav) },
    { label: 'Clipboard', value: yn(nav && 'clipboard' in nav) },
  ]
}

export const formatDiagnostics = (rows: DiagRow[], extra: DiagRow[] = []) =>
  ['MeetNotes diagnostics', ...[...rows, ...extra].map((r) => `${r.label}: ${r.value}`)].join('\n')

export interface MicTestResult {
  ok: boolean
  /** Short plain-language outcome for the person. */
  summary: string
  rows: DiagRow[]
}

/**
 * Record about three seconds exactly the way the Record page does (same format, one-second chunks), then check that
 * data arrived and that the browser can play it back. This is the quickest way to find out whether a phone really works.
 */
export async function testRecording(seconds = 3): Promise<MicTestResult> {
  const rows: DiagRow[] = []
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, summary: 'This browser cannot record audio.', rows }
  }
  const mime = pickRecorderMime()
  let stream: MediaStream | undefined
  try {
    const t0 = performance.now()
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    rows.push({ label: 'Microphone opened in', value: `${Math.round(performance.now() - t0)} ms` })
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
    const stopped = new Promise<void>((res) => (rec.onstop = () => res()))
    rec.start(1000)
    await new Promise((r) => setTimeout(r, seconds * 1000))
    rec.stop()
    await stopped
    const blob = new Blob(chunks, { type: rec.mimeType || mime || '' })
    rows.push({ label: 'Format', value: rec.mimeType || mime || 'unknown' })
    rows.push({ label: 'Chunks received', value: String(chunks.length) })
    rows.push({ label: 'Size', value: `${Math.round(blob.size / 1000)} kB` })
    if (blob.size === 0) return { ok: false, summary: 'The microphone opened but no audio was recorded.', rows }

    const playable = await new Promise<boolean>((resolve) => {
      const url = URL.createObjectURL(blob)
      const a = new Audio()
      const done = (v: boolean) => (URL.revokeObjectURL(url), resolve(v))
      const timer = setTimeout(() => done(false), 4000)
      a.onloadedmetadata = () => (clearTimeout(timer), done(true))
      a.onerror = () => (clearTimeout(timer), done(false))
      a.src = url
    })
    rows.push({ label: 'Plays back', value: yn(playable) })
    return playable
      ? { ok: true, summary: 'Recording works on this device.', rows }
      : { ok: false, summary: 'Audio was recorded but this browser could not play it back. Tell us about this device.', rows }
  } catch (e) {
    const name = (e as { name?: string }).name ?? 'Error'
    const msg =
      name === 'NotAllowedError' ? 'Microphone permission was refused. Allow it in the browser or phone settings.'
      : name === 'NotFoundError' ? 'No microphone was found.'
      : name === 'NotReadableError' ? 'The microphone is busy (another app may be using it).'
      : `Recording failed (${name}).`
    return { ok: false, summary: msg, rows }
  } finally {
    stream?.getTracks().forEach((t) => t.stop())
  }
}
