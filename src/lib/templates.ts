import type { TKey } from '../i18n/translate'

/** Meeting types. Keep in step with functions/lib/templates.ts and the CHECK constraint in the migration (a test compares them). */
export const TEMPLATE_IDS = ['general', 'standup', 'one_on_one', 'client_call', 'interview', 'brainstorm'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export const isTemplate = (v: unknown): v is TemplateId => (TEMPLATE_IDS as readonly unknown[]).includes(v)

export const templateName = (id: TemplateId) => `template.${id}.name` as TKey
export const templateHelp = (id: TemplateId) => `template.${id}.help` as TKey

const KEY = 'meetnotes.template'

export function readTemplate(): TemplateId {
  try {
    const v = localStorage.getItem(KEY)
    return isTemplate(v) ? v : 'general'
  } catch {
    return 'general'
  }
}

export function saveTemplate(id: TemplateId): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* not persisted */
  }
}

/** True when the notes on screen were written for a different meeting type than the one now selected. */
export function templateChanged(current: string | undefined, notesTemplate: string | null | undefined): boolean {
  return (current ?? 'general') !== (notesTemplate ?? 'general')
}
