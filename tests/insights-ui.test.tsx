// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// A stand-in for supabase.from(table)...: every chained call returns the builder, awaiting it yields the table's result.
const db = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  calls: [] as { table: string; calls: unknown[][] }[],
}))
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rec = { table, calls: [] as unknown[][] }
      db.calls.push(rec)
      const builder: unknown = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(db.tables[table]).then(res, rej)
          return (...args: unknown[]) => {
            rec.calls.push([prop, ...args])
            return builder
          }
        },
      })
      return builder
    },
  },
}))

import { I18nProvider } from '../src/i18n/I18nProvider'
import Insights from '../src/pages/Insights'

const meeting = (id: string, date: string, minutes: number) => ({ id, meeting_date: `${date}T09:00:00Z`, duration_seconds: minutes * 60, status: 'done' })
const item = (id: string, meeting_id: string, task: string, owner: string | null, due: string | null, done = false, title = 'Sync') => ({
  id, meeting_id, task, owner, due_date: due, is_done: done, meetings: { title },
})

function seed(over: Partial<Record<'meetings' | 'action_items' | 'meeting_notes', { data: unknown; error: unknown }>> = {}) {
  db.tables = {
    meetings: { data: [meeting('m1', '2026-10-27', 60), meeting('m2', '2026-10-21', 30), meeting('m3', '2026-10-14', 30)], error: null },
    action_items: {
      data: [
        item('a1', 'm1', 'Send the press release', 'Priya', '2026-10-20'), // overdue
        item('a2', 'm2', 'Confirm the budget', 'Rahul', '2026-10-30'), // due soon
        item('a3', 'm1', 'Book the venue', 'Priya', null, true), // done
        item('a4', 'm3', 'Review the roadmap', null, '2026-12-01'),
      ],
      error: null,
    },
    meeting_notes: {
      data: [
        { meeting_id: 'm1', summary: 'We discussed the website launch and the budget.', decisions: ['Launch the website on Friday'] },
        { meeting_id: 'm2', summary: 'The website launch plan and hiring.', decisions: [] },
        { meeting_id: 'm3', summary: 'Budget review and the roadmap.', decisions: null },
      ],
      error: null,
    },
    ...over,
  }
}
const page = () => render(<I18nProvider><MemoryRouter><Insights /></MemoryRouter></I18nProvider>)

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z'), toFake: ['Date'] }) // only the clock; React's timers stay real
  localStorage.clear()
  db.calls = []
  seed()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Insights page', () => {
  it('summarises the period with a comparison to the previous one', async () => {
    page()
    expect(await screen.findByText('Meetings')).toBeTruthy()
    // 3 meetings, 2 h total (60+30+30 min), 40 min average; nothing before them to compare with, so no delta text
    const tiles = screen.getByText('Hours recorded').closest('div')!.parentElement!
    expect(within(tiles).getByText('3')).toBeTruthy()
    expect(within(tiles).getByText('2')).toBeTruthy()
    expect(within(tiles).getByText('40 min')).toBeTruthy()
    expect(screen.queryByText(/vs previous/)).toBeNull()
  })

  it('shows a signed change when the previous period has data', async () => {
    seed({ meetings: { data: [meeting('m1', '2026-10-27', 60), meeting('m2', '2026-10-21', 30), meeting('p1', '2026-09-22', 30)], error: null } })
    page()
    await screen.findByText('Meetings')
    // In the 4-week view p1 (Sep 22) falls in the *previous* 4 weeks: 2 meetings now vs 1 before = +100%.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Last 4 weeks' }))
    await waitFor(() => expect(screen.getAllByText('+100% vs previous 4 weeks').length).toBeGreaterThan(0))
  })

  it('draws one column per week with its figures reachable by keyboard and in a table', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Meetings per week')
    expect(screen.getAllByRole('listitem').filter((li) => /meetings/.test(li.getAttribute('aria-label') ?? '')).length).toBe(12)
    await user.click(screen.getByRole('button', { name: 'View as table' }))
    expect(screen.getByRole('table', { name: 'Meetings per week' })).toBeTruthy()
  })

  it('counts open, overdue and soon-due action items, and lists what is overdue with a link', async () => {
    page()
    const section = await screen.findByRole('region', { name: 'Action items' })
    // "Overdue" is both a tile label (<p>) and a sub-heading (<h4>); take the tile.
    const tile = (label: string) => within(section).getAllByText(label).find((el) => el.tagName === 'P')!.closest('div')!
    expect(within(tile('Open now')).getByText('3')).toBeTruthy()
    expect(within(tile('Overdue')).getByText('⚠ 1')).toBeTruthy() // icon + number, never colour alone
    expect(within(tile('Due in 7 days')).getByText('1')).toBeTruthy()
    expect(within(section).getByText('Send the press release')).toBeTruthy()
    expect(within(section).getByRole('link', { name: 'Sync' }).getAttribute('href')).toBe('/meeting/m1')
    expect(within(section).getByText('25%')).toBeTruthy() // 1 of 4 items done
  })

  it('says so when nothing is overdue', async () => {
    seed({ action_items: { data: [item('a2', 'm2', 'Confirm the budget', 'Rahul', '2026-10-30')], error: null } })
    page()
    expect(await screen.findByText('Nothing is overdue.')).toBeTruthy()
  })

  it('lists open work by owner with overdue flagged, unassigned last', async () => {
    page()
    const section = await screen.findByRole('region', { name: 'Open items by owner' })
    const rows = within(section).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows).toEqual(['Priya1⚠ 1', 'Rahul10', 'Unassigned10']) // Priya's finished item is excluded
  })

  it('shows topics that recur across meetings, ranked by how many mention them', async () => {
    page()
    const section = await screen.findByRole('region', { name: 'Frequent topics' })
    const items = within(section).getAllByRole('listitem').map((li) => li.textContent)
    expect(items.some((t) => t?.startsWith('website') && t.endsWith('in 2 meetings'))).toBe(true)
    expect(items.some((t) => t?.startsWith('budget') && t.endsWith('in 3 meetings'))).toBe(true) // budget is in all three
    expect(items.some((t) => /^(the|and)\b/.test(t ?? ''))).toBe(false) // function words are not topics
  })

  it('re-queries when the period changes', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Meetings')
    const before = db.calls.filter((c) => c.table === 'meetings').length
    await user.click(screen.getByRole('button', { name: 'Last 26 weeks' }))
    await waitFor(() => expect(db.calls.filter((c) => c.table === 'meetings').length).toBeGreaterThan(before))
  })

  it('invites you to record when there is nothing yet', async () => {
    seed({ meetings: { data: [], error: null }, action_items: { data: [], error: null }, meeting_notes: { data: [], error: null } })
    page()
    expect(await screen.findByText(/Insights appear once you have finished a few meetings/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Record a meeting' }).getAttribute('href')).toBe('/record')
  })

  it('shows an error instead of a half-empty page if loading fails', async () => {
    seed({ meetings: { data: null, error: { message: 'boom' } } })
    page()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load insights.')
  })
})
