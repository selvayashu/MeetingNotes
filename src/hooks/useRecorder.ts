import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_RECORDING_SECONDS, SEGMENT_SECONDS, pickRecorderMime } from '../lib/audio'

export type RecorderError = 'unsupported' | 'denied' | 'nomic' | 'start' | 'failed'
export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped'

export interface AudioPart {
  blob: Blob
  durationSeconds: number
}

export interface RecordedAudio {
  parts: AudioPart[]
  durationSeconds: number
}

/**
 * Records from the mic as a series of self-contained segments (~SEGMENT_SECONDS each).
 * The server can't cut webm/mp4 without ffmpeg, so each segment is its own valid file
 * that Whisper can transcribe independently.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<RecorderError | null>(null)
  const [result, setResult] = useState<RecordedAudio | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const mime = useRef<string | undefined>(undefined)
  const parts = useRef<AudioPart[]>([])
  const finishing = useRef(false)
  const segmentStart = useRef(0) // recording-seconds at which the current segment began
  const stopSegment = useRef<((at: number) => void) | null>(null)
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

  const startSegment = useCallback(() => {
    const s = stream.current
    if (!s) return
    const chunks: Blob[] = []
    const seg = { begin: currentElapsed(), end: 0 }
    const rec = new MediaRecorder(s, mime.current ? { mimeType: mime.current, audioBitsPerSecond: 32000 } : undefined)
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
    rec.onstop = () => {
      parts.current.push({
        blob: new Blob(chunks, { type: rec.mimeType || mime.current || 'audio/webm' }),
        durationSeconds: Math.round(seg.end - seg.begin),
      })
      if (finishing.current) {
        const total = Math.round(seg.end)
        setElapsed(total)
        setResult({ parts: parts.current, durationSeconds: total })
        setState('stopped')
        cleanup()
      }
    }
    rec.onerror = () => {
      setError('failed')
      cleanup()
      setState('idle')
    }
    segmentStart.current = seg.begin
    recorder.current = rec
    stopSegment.current = (at: number) => {
      seg.end = at
      rec.stop()
    }
    rec.start(1000) // 1s timeslices keep memory use flat
  }, [cleanup])

  const stop = useCallback(() => {
    const rec = recorder.current
    if (!rec || rec.state === 'inactive') return
    accumulated.current = currentElapsed()
    resumedAt.current = 0
    finishing.current = true
    stopSegment.current?.(accumulated.current) // onstop assembles the final part
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setResult(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('unsupported')
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
      stream.current = s
      mime.current = pickRecorderMime()
      parts.current = []
      finishing.current = false

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
      startSegment()
      setElapsed(0)
      setState('recording')
      tick.current = window.setInterval(() => {
        const e = currentElapsed()
        setElapsed(Math.floor(e))
        if (e >= MAX_RECORDING_SECONDS) {
          stop()
        } else if (
          recorder.current?.state === 'recording' &&
          e - segmentStart.current >= SEGMENT_SECONDS
        ) {
          // Rotate: close this segment and open the next on the same mic stream.
          // The segment boundary may cut a word; the gap is a few milliseconds.
          accumulated.current = e
          resumedAt.current = performance.now()
          stopSegment.current?.(e)
          startSegment()
        }
      }, 250)
    } catch (err) {
      cleanup()
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'denied'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'nomic'
            : 'start',
      )
    }
  }, [cleanup, startSegment, stop])

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
