import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nContext } from './context'
import { detectLang, translate, type TKey, type UiLang, type Vars } from './translate'

const STORAGE_KEY = 'meetnotes.lang'

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(() =>
    detectLang(readSaved(), typeof navigator === 'undefined' ? [] : navigator.languages ?? []),
  )

  const setLang = useCallback((l: UiLang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* storage unavailable: the choice just won't persist */
    }
  }, [])

  // Screen readers and the browser's font fallback both rely on the document language.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo(
    () => ({ lang, setLang, t: (key: TKey, vars?: Vars) => translate(lang, key, vars) }),
    [lang, setLang],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
