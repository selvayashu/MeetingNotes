import type { Lang } from './types'

/**
 * Live captions use the browser's own speech recognition (Web Speech API). It is a rough on-screen preview only:
 * nothing from it is stored or sent to our servers, and the real transcript is still made by Whisper after the
 * recording. In Chrome and Edge the browser itself sends the audio to its vendor's speech service, so the feature is
 * off until the person turns it on, with that stated next to the switch.
 */

// Just the parts of the API we use; the TypeScript DOM library does not ship these types.
export interface SpeechAlternativeLike {
  transcript: string
}
export interface SpeechResultLike {
  isFinal: boolean
  0: SpeechAlternativeLike
}
export interface SpeechEventLike {
  resultIndex: number
  results: { length: number; [i: number]: SpeechResultLike }
}
export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function getRecognitionCtor(w: Window = window): SpeechRecognitionCtor | null {
  const x = w as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return x.SpeechRecognition ?? x.webkitSpeechRecognition ?? null
}

/** Recognition cannot auto-detect, so "auto" follows the interface language. */
export function recognitionLang(spoken: Lang, uiLang: string): string {
  const pick = spoken === 'auto' ? uiLang : spoken
  return pick === 'hi' ? 'hi-IN' : pick === 'ta' ? 'ta-IN' : 'en-IN'
}

export type CaptionProblem = 'denied' | 'network' | 'language' | 'unavailable'

/** Map a Web Speech error code to something worth telling the person. null = harmless (silence, we stopped it). */
export function problemFor(error: string): CaptionProblem | null {
  switch (error) {
    case 'no-speech':
    case 'aborted':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied'
    case 'network':
      return 'network'
    case 'language-not-supported':
      return 'language'
    default:
      return 'unavailable'
  }
}

/** Finished sentences and the still-changing tail from one recognition event. */
export function readResults(e: SpeechEventLike): { finals: string[]; interim: string } {
  const finals: string[] = []
  let interim = ''
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i]
    const text = r[0]?.transcript?.trim() ?? ''
    if (!text) continue
    if (r.isFinal) finals.push(text)
    else interim += (interim ? ' ' : '') + text
  }
  return { finals, interim }
}

/** Keep the on-screen list from growing without bound during a long meeting. */
export const MAX_CAPTION_LINES = 150
export const trimLines = (lines: string[], max = MAX_CAPTION_LINES) => (lines.length > max ? lines.slice(-max) : lines)

const KEY = 'meetnotes.liveCaptions'
export function readCaptionsPref(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
export function saveCaptionsPref(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* not persisted */
  }
}
