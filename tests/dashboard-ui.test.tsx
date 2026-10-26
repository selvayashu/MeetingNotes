// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const db = vi.hoisted(() => ({ meetings: [] as unknown[], overdue: 0 }))
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let head = false
      const b: unknown = new Proxy({}, {
        get: (_t, p) => {
          if (p === 'then')
            return (res: (v: unknown) => unknown) =>
              Promise.resolve(table === 'meetings' ? { data: db.meetings, error: null } : { data: null, count: db.overdue, error: null, head }).then(res)
          return (...a: unknown[]) => {
            if (p === 'select' && (a[1] as { head?: boolean } | undefined)?.head) head = true
            return b
          }
        },
      })
      return b
    },
  },
}))
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../src/hooks/useQueueSync', () => ({ useQueueSync: () => ({ pending: 0 }) }))
vi.mock('../src/hooks/useDraftRecovery', () => ({ useDraftRecovery: () => ({ found: null }) }))
vi.mock('../src/lib/api', () => ({ processMeeting: vi.fn() }))

import { I18nProvider } from '../src/i18n/I18nProvider'
import Dashboard from '../src/pages/Dashboard'

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
const m = (id: string, title: string, days: number, minutes: number, status = 'done') => ({
  id, title, meeting_date: ago(days), language: 'en', duration_seconds: minutes * 60, status, error_message: null, processed_parts: 1, audio_parts: [{}],
})
const page = () => render(<I18nProvider><MemoryRouter><Dashboard /></MemoryRouter></I18nProvider>)

beforeEach(() => {
  localStorage.clear()
  db.overdue = 0
  db.meetings = [m('a1', 'Launch planning', 1, 30), m('a2', 'Stand-up', 2, 30), m('a3', 'Old review', 20, 60), m('a4', 'Writing', 1, 10, 'summarising')]
})
afterEach(cleanup)

describe('dashboard (friendly cards)', () => {
  it('leads with a "start a new meeting" card that links to recording', async () => {
    page()
    const hero = await screen.findByRole('region', { name: 'Start a new meeting' })
    expect(within(hero).getByRole('link', { name: 'New recording' }).getAttribute('href')).toBe('/record')
  })

  it('summarises the last 7 days: finished meetings and hours only', async () => {
    page()
    await screen.findByText('Launch planning')
    // 2 finished meetings in the last week (the 20-day-old and the unfinished one do not count); 60 min = 1 h
    const meetings = screen.getByText('Meetings, 7 days').parentElement!
    expect(within(meetings).getByText('2')).toBeTruthy()
    expect(screen.getByText('Recorded, 7 days').parentElement!.textContent).toContain('1 h')
  })

  it('flags overdue actions with a symbol and a link to Insights, and stays calm at zero', async () => {
    db.overdue = 3
    page()
    const tile = (await screen.findByText('Overdue actions')).closest('a')!
    expect(tile.getAttribute('href')).toBe('/insights')
    expect(tile.textContent).toContain('⚠ 3')
    cleanup()
    db.overdue = 0
    page()
    await waitFor(() => expect(screen.getByText('Overdue actions').closest('a')!.textContent).not.toContain('⚠'))
  })

  it('shows each meeting as a card with a date badge, status and link', async () => {
    page()
    const link = await screen.findByRole('link', { name: 'Launch planning' })
    expect(link.getAttribute('href')).toBe('/meeting/a1')
    const card = link.closest('li')!
    expect(within(card).getByText('Done')).toBeTruthy()
    const day = String(new Date(ago(1)).getDate())
    expect(card.querySelector('[aria-hidden="true"]')!.textContent).toContain(day) // badge is decoration; the date is also in the text
    expect(card.textContent).toContain(new Date(ago(1)).toLocaleDateString('en'))
  })

  it('keeps showing the first-run guide, and no stat tiles, when there are no meetings', async () => {
    db.meetings = []
    page()
    expect(await screen.findByText('Welcome to MeetNotes')).toBeTruthy()
    expect(screen.queryByText('Meetings, 7 days')).toBeNull()
  })
})
