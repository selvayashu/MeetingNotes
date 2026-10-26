import { useEffect, useRef, useState } from 'react'
import {
  getRecognitionCtor,
  problemFor,
  readResults,
  trimLines,
  type CaptionProblem,
  type SpeechRecognitionLike,
} from '../lib/liveCaptions'

const RESTART_DELAY_MS = 250
/** Chrome ends a session after a stretch of silence; restarting is normal. Ending again and again at once is not. */
const MAX_QUICK_ENDS = 5
const QUICK_END_MS = 1500

interface Options {
  /** Listen only while true (recording, not paused). */
  active: boolean
  /** BCP-47 tag such as hi-IN. */
  lang: string
  /** The person switched captions on. */
  enabled: boolean
  /** Forget what was captured (a new recording starts). */
  resetKey: unknown
}

/** On-screen captions from the browser's speech recognition. Display only: nothing is stored or uploaded. */
export function useLiveCaptions({ active, lang, enabled, resetKey }: Options) {
  const [lines, setLines] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [problem, setProblem] = useState<CaptionProblem | null>(null)
  const supported = getRecognitionCtor() !== null

  const live = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    setLines([])
    setInterim('')
    setProblem(null)
  }, [resetKey])

  useEffect(() => {
    const Ctor = getRecognitionCtor()
    if (!enabled || !active || !Ctor) return

    let stopped = false
    let quickEnds = 0
    let startedAt = 0
    let timer: number | undefined
    setProblem(null)

    const begin = () => {
      if (stopped) return
      const r = new Ctor()
      r.continuous = true
      r.interimResults = true
      r.lang = lang
      r.onresult = (e) => {
        const { finals, interim: tail } = readResults(e)
        if (finals.length) setLines((l) => trimLines([...l, ...finals]))
        setInterim(tail)
      }
      r.onerror = (e) => {
        const p = problemFor(e.error)
        if (p) {
          setProblem(p)
          stopped = true // these do not get better by retrying
        }
      }
      r.onend = () => {
        setInterim('')
        if (stopped) return
        quickEnds = Date.now() - startedAt < QUICK_END_MS ? quickEnds + 1 : 0
        if (quickEnds >= MAX_QUICK_ENDS) {
          setProblem('unavailable')
          stopped = true
          return
        }
        timer = window.setTimeout(begin, RESTART_DELAY_MS)
      }
      live.current = r
      startedAt = Date.now()
      try {
        r.start()
      } catch {
        setProblem('unavailable')
        stopped = true
      }
    }
    begin()

    return () => {
      stopped = true
      window.clearTimeout(timer)
      const r = live.current
      live.current = null
      if (r) {
        r.onresult = r.onerror = r.onend = null
        try {
          r.abort()
        } catch {
          /* already stopped */
        }
      }
      setInterim('')
    }
  }, [enabled, active, lang])

  return { supported, lines, interim, problem }
}
