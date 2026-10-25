import type { Lang } from './types'

const KEY = 'meetnotes.spokenLanguage'
const VALID: Lang[] = ['auto', 'en', 'hi', 'ta']

/**
 * Which spoken language the Record page starts on. Measured: letting Whisper auto-detect Hindi picks the wrong
 * language 1 time in 4 and raises word errors from ~30% to ~49%, so we start from what the user chose last time,
 * else their interface language when it is Hindi or Tamil, else Auto-detect (reliable for English).
 */
export function defaultSpokenLanguage(saved: string | null, uiLang: string): Lang {
  if (saved && (VALID as string[]).includes(saved)) return saved as Lang
  return uiLang === 'hi' || uiLang === 'ta' ? uiLang : 'auto'
}

export function readSpokenLanguage(uiLang: string): Lang {
  try {
    return defaultSpokenLanguage(localStorage.getItem(KEY), uiLang)
  } catch {
    return defaultSpokenLanguage(null, uiLang)
  }
}

export function saveSpokenLanguage(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    /* not persisted */
  }
}
