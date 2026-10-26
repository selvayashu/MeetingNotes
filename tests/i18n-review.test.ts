import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs helper without types
import { HEADER, applyChanges, buildRows, parseCsv, readSheet, screenOf, toCsv } from '../scripts/i18n-review-lib.mjs'
import { dictionaries } from '../src/i18n/translate'

const en = { 'login.signIn': 'Sign in', 'usage.of': '{used} of {cap}', 'tabs.summary': 'Summary', 'sample.t1': 'Hello' }
const hi = { 'login.signIn': 'साइन इन', 'usage.of': '{cap} में से {used}', 'tabs.summary': 'सार', 'sample.t1': 'नमस्ते' }
const sheet = (rows: string[][]) => toCsv([HEADER, ...rows])

describe('csv', () => {
  it('round-trips commas, quotes, newlines and Indic text', () => {
    const rows = [['a,b', 'say "hi"', 'two\nlines', 'தமிழ் हिन्दी', '']]
    expect(parseCsv(toCsv(rows))).toEqual([['a,b', 'say "hi"', 'two\nlines', 'தமிழ் हिन्दी', '']])
  })
  it('reads what Excel in other regions writes: semicolons or tabs, CRLF, no trailing newline', () => {
    expect(parseCsv('﻿Key;Corrected\r\nx;y z')).toEqual([['Key', 'Corrected'], ['x', 'y z']])
    expect(parseCsv('Key\tCorrected\nx\ty')).toEqual([['Key', 'Corrected'], ['x', 'y']])
  })
  it('starts with a BOM so Excel opens it as UTF-8', () => {
    expect(toCsv([['नमस्ते']]).charCodeAt(0)).toBe(0xfeff)
  })
})

describe('export', () => {
  it('has a row per string, grouped by screen, with a readable screen name', () => {
    const rows = buildRows(en, hi)
    expect(rows[0]).toEqual(HEADER)
    expect(rows).toHaveLength(5)
    expect(rows.find((r: string[]) => r[0] === 'login.signIn')).toEqual(['login.signIn', 'Sign in / create account', 'Sign in', 'साइन इन', '', ''])
    expect(screenOf('nothing.here')).toBe('nothing')
  })
  it('covers every real key in both languages', () => {
    for (const l of ['hi', 'ta'] as const) {
      const rows = buildRows(dictionaries.en, dictionaries[l])
      expect(rows.length - 1).toBe(Object.keys(dictionaries.en).length)
      expect(rows.every((r: string[], i: number) => i === 0 || r[3])).toBe(true) // nothing blank in the "current" column
    }
  })
})

describe('reading a reviewed sheet', () => {
  it('takes only the rows with corrected text that actually differ', () => {
    const csv = sheet([
      ['login.signIn', '', 'Sign in', 'साइन इन', 'लॉग इन', ''],
      ['tabs.summary', '', 'Summary', 'सार', '', 'maybe use सारांश everywhere'],
      ['sample.t1', '', 'Hello', 'नमस्ते', 'नमस्ते', ''], // same as current: no change
    ])
    const r = readSheet(csv, en, hi)
    expect(r.changes).toEqual([{ key: 'login.signIn', from: 'साइन इन', to: 'लॉग इन' }])
    expect(r.comments).toEqual([{ key: 'tabs.summary', note: 'maybe use सारांश everywhere' }])
    expect(r.problems).toEqual([])
  })

  it('allows moving a placeholder but not dropping or renaming one', () => {
    const r = readSheet(
      sheet([
        ['usage.of', '', '', '', '{used}/{cap} इस्तेमाल हुआ', ''],
        ['usage.of', '', '', '', '{used} में से', ''],
        ['usage.of', '', '', '', '{used} में से {total}', ''],
      ]),
      en,
      hi,
    )
    expect(r.changes).toHaveLength(1)
    expect(r.problems).toHaveLength(2)
    expect(r.problems[0]).toMatch(/placeholders/)
  })

  it('does not apply unknown keys and trims stray spaces', () => {
    const r = readSheet(sheet([['made.up', '', '', '', 'x', ''], ['login.signIn', '', '', '', '  लॉग इन \n', '']]), en, hi)
    expect(r.problems[0]).toMatch(/unknown key "made.up"/)
    expect(r.changes[0].to).toBe('लॉग इन')
  })

  it('explains a damaged header instead of silently doing nothing', () => {
    const r = readSheet('Name,Value\r\nx,y\r\n', en, hi)
    expect(r.changes).toEqual([])
    expect(r.problems[0]).toMatch(/header/)
  })
})

describe('applying', () => {
  const file = '{\n  "login.signIn": "साइन इन",\n  "usage.of": "{cap} में से {used}",\n\n  "tabs.summary": "सार"\n}\n'
  it('changes only the named values and keeps layout, order, commas and blank lines', () => {
    const out = applyChanges(file, [{ key: 'tabs.summary', to: 'सारांश' }, { key: 'login.signIn', to: 'लॉग इन "अभी"' }])
    expect(out).toBe('{\n  "login.signIn": "लॉग इन \\"अभी\\"",\n  "usage.of": "{cap} में से {used}",\n\n  "tabs.summary": "सारांश"\n}\n')
    expect(JSON.parse(out)['login.signIn']).toBe('लॉग इन "अभी"')
  })
  it('stops on a key that is not in the file', () => {
    expect(() => applyChanges(file, [{ key: 'nope', to: 'x' }])).toThrow(/not found/)
  })
})
