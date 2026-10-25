import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildTimeline, locate, totalMs } from '../lib/timeline'
import type { AudioPart } from '../lib/types'

/**
 * Plays a meeting's audio parts as one continuous timeline. Parts are separate files, so
 * seeking may switch the <audio> source; reaching the end of a part continues into the next.
 */
export function useAudioTimeline(parts: AudioPart[]) {
  const timeline = useMemo(() => buildTimeline(parts), [parts])
  const [urls, setUrls] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRateState] = useState(1)

  const audio = useRef<HTMLAudioElement | null>(null)
  const index = useRef(0)
  const pending = useRef<{ seconds: number; play: boolean } | null>(null)
  const rateRef = useRef(1)

  // Signed URLs: the bucket is private.
  useEffect(() => {
    let cancelled = false
    setUrls(null)
    if (parts.length === 0) return
    supabase.storage
      .from('recordings')
      .createSignedUrls(parts.map((p) => p.path), 3600)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data || data.some((d) => !d.signedUrl)) {
          setError('Could not load the audio.')
        } else {
          setUrls(data.map((d) => d.signedUrl as string))
        }
      })
    return () => {
      cancelled = true
    }
  }, [parts])

  const load = useCallback((urlList: string[], i: number, seconds: number, play: boolean) => {
    const a = audio.current
    if (!a) return
    index.current = i
    pending.current = { seconds, play }
    a.src = urlList[i]
    a.playbackRate = rateRef.current
    a.load()
  }, [])

  useEffect(() => {
    if (!urls) return
    const a = new Audio()
    a.preload = 'metadata'
    audio.current = a

    a.onloadedmetadata = () => {
      const p = pending.current
      pending.current = null
      if (p) {
        a.currentTime = p.seconds
        if (p.play) void a.play().catch(() => setPlaying(false))
      }
    }
    a.ontimeupdate = () => {
      const t = timeline[index.current]
      if (t) setCurrentMs(t.startMs + a.currentTime * 1000)
    }
    a.onplay = () => setPlaying(true)
    a.onpause = () => setPlaying(false)
    a.onended = () => {
      if (index.current + 1 < urls.length) load(urls, index.current + 1, 0, true)
      else setPlaying(false)
    }
    a.onerror = () => setError('Audio could not be played. Reload the page to refresh the link.')

    load(urls, 0, 0, false)
    return () => {
      a.pause()
      a.removeAttribute('src')
      a.load()
      audio.current = null
    }
  }, [urls, timeline, load])

  const seekMs = useCallback(
    (ms: number, play = true) => {
      const a = audio.current
      if (!a || !urls) return
      const { index: i, offsetMs } = locate(timeline, ms)
      setCurrentMs(timeline[i] ? timeline[i].startMs + offsetMs : 0)
      if (i === index.current && a.readyState > 0) {
        a.currentTime = offsetMs / 1000
        if (play) void a.play().catch(() => {})
      } else {
        load(urls, i, offsetMs / 1000, play)
      }
    },
    [timeline, urls, load],
  )

  const toggle = useCallback(() => {
    const a = audio.current
    if (!a) return
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  }, [])

  const setRate = useCallback((r: number) => {
    rateRef.current = r
    setRateState(r)
    if (audio.current) audio.current.playbackRate = r
  }, [])

  return {
    ready: urls !== null,
    error,
    currentMs,
    playing,
    rate,
    durationMs: totalMs(timeline),
    seekMs,
    toggle,
    setRate,
  }
}

export type AudioTimeline = ReturnType<typeof useAudioTimeline>
