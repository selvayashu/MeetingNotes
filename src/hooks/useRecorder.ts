import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_RECORDING_SECONDS, pickRecorderMime } from '../lib/audio'

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped'

export interface RecordedAudio {
  blob: Blob
  durationSeconds: number
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecordedAudio | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const audioCtx = useRef<AudioContext | null>(null)
  const raf = useRef(0)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  // Accumulated recording time excluding paused periods.
  const accumulated = useRef(0)
  const resumedAt = useRef(0)
  const tick = useRef<number | undefined>(undefined)

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current)
    window.clearInterval(tick.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    void audioCtx.current?.close()
    audioCtx.current = null
    void wakeLock.current?.release().catch(() => {})
    wakeLock.current = null
    setLevel(0)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const currentElapsed = () =>
    accumulated.current + (resumedAt.current ? (performance.now() - resumedAt.current) / 1000 : 0)

  const stop = useCallback(() => {
    const rec = recorder.current
    if (!rec || rec.state === 'inactive') return
    accumulated.current = currentElapsed()
    resumedAt.current = 0
    rec.stop() // onstop assembles the blob
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setResult(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Recording is not supported in this browser. Try uploading a file instead.')
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
      stream.current = s

      const mime = pickRecorderMime()
      const rec = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined)
      chunks.current = []
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data)
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType || mime || 'audio/webm' })
        setElapsed(Math.floor(accumulated.current))
        setResult({ blob, durationSeconds: Math.round(accumulated.current) })
        setState('stopped')
        cleanup()
      }
      rec.onerror = () => {
        setError('Recording failed.')
        cleanup()
        setState('idle')
      }
      recorder.current = rec

      // Mic level meter
      const ctx = new AudioContext()
      audioCtx.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(s).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const loop = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        setLevel(Math.min(1, peak / 64))
        raf.current = requestAnimationFrame(loop)
      }
      loop()

      // Keep the screen awake so the recording isn't suspended mid-meeting.
      try {
        wakeLock.current = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        /* optional */
      }

      accumulated.current = 0
      resumedAt.current = performance.now()
      rec.start(1000) // 1s timeslices keep memory use flat for long meetings
      setElapsed(0)
      setState('recording')
      tick.current = window.setInterval(() => {
        const e = currentElapsed()
        setElapsed(Math.floor(e))
        if (e >= MAX_RECORDING_SECONDS) stop()
      }, 250)
    } catch (err) {
      cleanup()
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied.'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'No microphone found.'
            : 'Could not start recording.',
      )
    }
  }, [cleanup, stop])

  const pause = useCallback(() => {
    if (recorder.current?.state !== 'recording') return
    recorder.current.pause()
    accumulated.current = currentElapsed()
    resumedAt.current = 0
    setState('paused')
  }, [])

  const resume = useCallback(() => {
    if (recorder.current?.state !== 'paused') return
    recorder.current.resume()
    resumedAt.current = performance.now()
    setState('recording')
  }, [])

  const reset = useCallback(() => {
    setResult(null)
    setElapsed(0)
    setState('idle')
  }, [])

  return { state, elapsed, level, error, result, start, pause, resume, stop, reset }
}
