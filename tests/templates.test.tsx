// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { systemPrompt } from '../functions/lib/notes'
import { TEMPLATE_IDS as SERVER_IDS, normaliseTemplate, templateGuidance } from '../functions/lib/templates'
import TemplateSelect from '../src/components/TemplateSelect'
import { I18nProvider } from '../src/i18n/I18nProvider'
import { dictionaries } from '../src/i18n/translate'
import { TEMPLATE_IDS as CLIENT_IDS, isTemplate, readTemplate, saveTemplate, templateChanged } from '../src/lib/templates'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('the three lists of meeting types agree', () => {
  it('server, app and database constraint have the same ids', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261025000011_meeting_templates.sql'), 'utf8')
    const inSql = [...sql.match(/check \(template in \(([^)]*)\)\)/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect([...SERVER_IDS]).toEqual(inSql)
    expect([...CLIENT_IDS]).toEqual(inSql)
  })

  it('every type has a name and description in all three languages', () => {
    for (const lang of ['en', 'hi', 'ta'] as const)
      for (const id of CLIENT_IDS) {
        expect(dictionaries[lang][`template.${id}.name` as keyof typeof dictionaries.en], `${lang}:${id}`).toBeTruthy()
        expect(dictionaries[lang][`template.${id}.help` as keyof typeof dictionaries.en], `${lang}:${id}`).toBeTruthy()
      }
  })
})

describe('server side', () => {
  it('unknown, missing or tampered values mean the standard notes', () => {
    for (const bad of [undefined, null, '', 'nope', 42, 'STANDUP', "x'; drop table"]) expect(normaliseTemplate(bad)).toBe('general')
    expect(normaliseTemplate('standup')).toBe('standup')
    expect(templateGuidance('nope')).toBe('')
  })

  it('every type except general has its own guidance, and they are all different', () => {
    const g = SERVER_IDS.filter((i) => i !== 'general').map(templateGuidance)
    expect(g.every((x) => x.length > 40)).toBe(true)
    expect(new Set(g).size).toBe(g.length)
    expect(templateGuidance('general')).toBe('')
  })

  const base = { outLang: 'en' as const, meetingDateIso: '2026-10-28T09:00:00Z' }
  it('puts the type into the prompt for both the per-part and the merge step', () => {
    for (const mode of ['chunk', 'merge'] as const) {
      expect(systemPrompt({ ...base, template: 'client_call' }, mode)).toContain('call with a client')
      expect(systemPrompt({ ...base, template: 'standup' }, mode)).toContain('stand-up')
    }
  })

  it('leaves the standard prompt untouched for general or no type', () => {
    expect(systemPrompt({ ...base, template: 'general' }, 'chunk')).toBe(systemPrompt(base, 'chunk'))
    expect(systemPrompt({ ...base, template: 'bogus' }, 'chunk')).toBe(systemPrompt(base, 'chunk'))
  })

  it('the interview type forbids rating candidates and inferring personal characteristics', () => {
    const p = systemPrompt({ ...base, template: 'interview' }, 'chunk')
    expect(p).toMatch(/do not rate the candidate/)
    expect(p).toMatch(/Never infer or mention age, gender/)
  })

  it('keeps the guidance ahead of the date line and does not disturb the output rules', () => {
    const p = systemPrompt({ ...base, template: 'brainstorm' }, 'chunk')
    expect(p).toContain('Respond with ONLY a JSON object')
    expect(p).toContain('due_date must be in English')
    expect(p.indexOf('brainstorming')).toBeLessThan(p.indexOf('Reference only'))
  })
})

describe('app side', () => {
  it('remembers the last choice, and ignores junk or blocked storage', () => {
    expect(readTemplate()).toBe('general')
    saveTemplate('interview')
    expect(readTemplate()).toBe('interview')
    localStorage.setItem('meetnotes.template', 'junk')
    expect(readTemplate()).toBe('general')
    expect(isTemplate('junk')).toBe(false)
  })

  it('knows when notes were written for another type (null means general)', () => {
    expect(templateChanged('general', null)).toBe(false)
    expect(templateChanged('general', 'general')).toBe(false)
    expect(templateChanged('standup', null)).toBe(true)
    expect(templateChanged('standup', 'client_call')).toBe(true)
    expect(templateChanged(undefined, 'standup')).toBe(true)
  })

  it('shows each type, describes the selected one, and reports changes', async () => {
    let picked = ''
    const { rerender } = render(<I18nProvider><TemplateSelect value="general" onChange={(id) => (picked = id)} /></I18nProvider>)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'General meeting', 'Stand-up', 'One-to-one', 'Client call', 'Interview', 'Brainstorm',
    ])
    expect(screen.getByText('Standard notes: summary, decisions and action items.')).toBeTruthy()
    await userEvent.setup().selectOptions(screen.getByLabelText('Meeting type'), 'interview')
    expect(picked).toBe('interview')
    rerender(<I18nProvider><TemplateSelect value="interview" onChange={() => {}} /></I18nProvider>)
    expect(screen.getByText(/does not rate or recommend candidates/)).toBeTruthy()
  })
})
