import { createContext, useContext } from 'react'
import type { TKey, UiLang, Vars } from './translate'

export interface I18n {
  lang: UiLang
  setLang: (l: UiLang) => void
  t: (key: TKey, vars?: Vars) => string
}

export const I18nContext = createContext<I18n | null>(null)

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
