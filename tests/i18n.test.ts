import { describe, expect, it } from 'vitest'
import { detectLang, dictionaries, translate, type TKey } from '../src/i18n/translate'
import { isDark } from '../src/theme'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const keys = Object.keys(dictionaries.en)

describe('dictionaries', () => {
  for (const lang of ['hi', 'ta'] as const) {
    it(`${lang} has exactly the English keys`, () => {
      const have = Object.keys(dictionaries[lang])
      expect(keys.filter((k) => !have.includes(k))).toEqual([]) // missing
      expect(have.filter((k) => !keys.includes(k))).toEqual([]) // stray
    })

    it(`${lang} keeps every {placeholder} and has no empty strings`, () => {
      for (const k of keys) {
        const v = dictionaries[lang][k]
        expect(v.trim(), `${lang}:${k} is empty`).not.toBe('')
        expect(placeholders(v), `${lang}:${k} placeholders`).toEqual(placeholders(dictionaries.en[k]))
      }
    })

    it(`${lang} is actually translated (uses its own script)`, () => {
      const script = lang === 'hi' ? /[ऀ-ॿ]/ : /[஀-௿]/
      const untranslated = keys.filter((k) => !script.test(dictionaries[lang][k]))
      // Only strings that are legitimately language-neutral may lack the script.
      expect(untranslated).toEqual([])
    })
  }
})

describe('translate', () => {
  it('fills placeholders', () => {
    expect(translate('en', 'approval.pendingBody', { email: 'a@b.co' })).toContain('a@b.co')
    expect(translate('ta', 'detail.progressSummarising', { done: 2, total: 5 })).toContain('2/5')
  })
  it('leaves unknown placeholders visible rather than crashing', () => {
    expect(translate('en', 'record.selected', {})).toBe('Selected: {name}')
  })
  it('falls back to English, then to the key', () => {
    const saved = dictionaries.hi['nav.signOut']
    delete dictionaries.hi['nav.signOut']
    expect(translate('hi', 'nav.signOut')).toBe('Sign out')
    dictionaries.hi['nav.signOut'] = saved
    expect(translate('en', 'nope' as TKey)).toBe('nope')
  })
})

describe('detectLang / theme', () => {
  it('prefers the saved choice, then the browser, then English', () => {
    expect(detectLang('ta', ['hi-IN'])).toBe('ta')
    expect(detectLang(null, ['fr-FR', 'hi-IN', 'en'])).toBe('hi')
    expect(detectLang('xx', ['de'])).toBe('en')
    expect(detectLang(null, [])).toBe('en')
  })
  it('resolves dark mode', () => {
    expect(isDark('dark', false)).toBe(true)
    expect(isDark('light', true)).toBe(false)
    expect(isDark('system', true)).toBe(true)
    expect(isDark('system', false)).toBe(false)
  })
})
