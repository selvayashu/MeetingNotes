import en from './en.json'
import hi from './hi.json'
import ta from './ta.json'

export type UiLang = 'en' | 'hi' | 'ta'
export type TKey = keyof typeof en
export type Vars = Record<string, string | number>

export const UI_LANGS: { code: UiLang; native: string }[] = [
  { code: 'en', native: 'English' },
  { code: 'hi', native: 'हिन्दी' },
  { code: 'ta', native: 'தமிழ்' },
]

export const dictionaries: Record<UiLang, Record<string, string>> = { en, hi, ta }

/** Look up a key, falling back to English, and fill `{placeholders}`. */
export function translate(lang: UiLang, key: TKey, vars?: Vars): string {
  const raw = dictionaries[lang][key] ?? en[key] ?? key
  return vars ? raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : raw
}

export function isUiLang(v: unknown): v is UiLang {
  return v === 'en' || v === 'hi' || v === 'ta'
}

/** Saved choice, else the browser's language if we support it, else English. */
export function detectLang(saved: string | null, browser: readonly string[]): UiLang {
  if (isUiLang(saved)) return saved
  for (const b of browser) {
    const base = b.toLowerCase().split('-')[0]
    if (isUiLang(base)) return base
  }
  return 'en'
}
