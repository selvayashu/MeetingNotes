// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { compact, labelIndexes, niceMax, niceMaxInteger } from '../src/lib/chartScale'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc } }))

import BarChart, { type Bar } from '../src/components/BarChart'
import { I18nProvider } from '../src/i18n/I18nProvider'
import AdminUsage from '../src/pages/AdminUsage'

describe('chart scale helpers', () => {
  it('rounds the axis end up to a clean number', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(-3)).toBe(1)
    expect(niceMax(Number.NaN)).toBe(1)
    expect(niceMax(5)).toBe(5)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(1234)).toBe(2000)
    expect(niceMax(8000)).toBe(10000)
    expect(niceMax(10000)).toBe(10000)
    expect(niceMax(10001)).toBe(20000)
  })
  it('keeps count axes in whole numbers (even end, so the middle tick is whole too)', () => {
    expect([0, 1, 2, 3, 5, 7, 11].map(niceMaxInteger)).toEqual([2, 2, 2, 4, 6, 8, 20])
    for (const v of [0, 1, 2, 3, 5, 7, 10, 11, 40, 99]) expect(niceMaxInteger(v) % 2).toBe(0)
  })
  it('compacts from 1,000 up', () => {
    expect([0, 999, 1000, 2500, 12000, 1_500_000].map(compact)).toEqual(['0', '999', '1K', '2.5K', '12K', '1.5M'])
  })
  it('prints a few x labels that never collide and always include the newest', () => {
    expect([...labelIndexes(3)].sort()).toEqual([0, 1, 2])
    for (const n of [7, 14, 30, 90]) {
      const idx = [...labelIndexes(n)].sort((a, b) => a - b)
      expect(idx.at(-1)).toBe(n - 1)
      expect(idx.length).toBeLessThanOrEqual(7)
      // Up to 7 bars every one is labelled; beyond that, labels are spaced so none sit next to each other.
      if (n > 7) for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBeGreaterThan(1)
    }
    expect(labelIndexes(0).size).toBe(0)
  })
})

const bars = (values: number[]): Bar[] => values.map((v, i) => ({ key: `d${i}`, label: `Oct ${i + 1}`, value: v, detail: `${v > 0 ? 1 : 0} meetings` }))
const labels = { viewTable: 'View as table', viewChart: 'View as chart', empty: 'No AI usage in this period.' }
const table = <table><tbody><tr><td>TABLE-TWIN</td></tr></tbody></table>

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  rpc.mockReset()
})

describe('BarChart', () => {
  const chart = (v: number[], extra = {}) =>
    render(<BarChart bars={bars(v)} title="AI units per day" unit="AI units" table={table} labels={labels} {...extra} />)

  it('renders one accessible column per day with its value', () => {
    chart([0, 100, 2500])
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[2].getAttribute('aria-label')).toBe('Oct 3: 2,500 AI units, 1 meetings')
    expect(items[0].getAttribute('aria-label')).toContain('Oct 1: 0 AI units')
  })

  it('labels only the newest value on the chart, not every bar', () => {
    chart([300, 400, 500, 600])
    expect(screen.getAllByText('600')).toHaveLength(1)
    expect(screen.queryByText('300')).toBeNull()
  })

  it('shows a tooltip on keyboard focus as well as hover, with the value first', async () => {
    const user = userEvent.setup()
    chart([100, 2500, 40])
    expect(screen.queryByRole('tooltip')).toBeNull()
    screen.getAllByRole('listitem')[1].focus()
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('2,500')
    expect(tip.textContent).toContain('Oct 2')
    expect(tip.textContent).toContain('1 meetings')
    await user.tab()
    expect(screen.getByRole('tooltip').textContent).toContain('Oct 3') // moves with focus
    await user.hover(screen.getAllByRole('listitem')[0])
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('Oct 1'))
  })

  it('has a table twin that replaces the chart, and a way back', async () => {
    const user = userEvent.setup()
    chart([1, 2, 3])
    expect(screen.queryByText('TABLE-TWIN')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'View as table' }))
    expect(screen.getByText('TABLE-TWIN')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'View as chart' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('draws a labelled limit line and extends the axis to include it', () => {
    chart([10, 20], { limit: { value: 8000, label: 'Daily cap 8,000' } })
    expect(screen.getByText('Daily cap 8,000')).toBeTruthy()
    expect(screen.getByText('10K')).toBeTruthy() // axis top = niceMax(8000), not niceMax(20)
  })

  it('says so when there is nothing to plot', () => {
    chart([0, 0, 0])
    expect(screen.getByText('No AI usage in this period.')).toBeTruthy()
  })
})

// ---------------- the admin page ----------------

interface Fake {
  used: number
  cap: number
  free: number
  daily?: object[]
  users?: object[]
  fail?: boolean
}
function serve(f: Fake) {
  const day = (offset: number, neurons: number) => ({ day: `2026-10-${25 - offset}`, neurons, audio_minutes: neurons / 40, meetings: neurons > 0 ? 2 : 0, calls: neurons > 0 ? 5 : 0 })
  rpc.mockImplementation(async (name: string) => {
    if (f.fail) return { data: null, error: { message: 'not authorized' } }
    if (name === 'admin_ai_overview') return { data: [{ used: f.used, cap: f.cap, reached: f.cap > 0 && f.used >= f.cap, free_allowance: f.free, day_start: '2026-10-25T00:00:00Z' }], error: null }
    if (name === 'admin_usage_daily') return { data: f.daily ?? [day(0, f.used), day(1, 3000), day(2, 0)], error: null }
    if (name === 'admin_usage_by_user')
      return { data: f.users ?? [{ user_id: 'u1', email: 'ann@x.co', full_name: 'Ann', neurons: 2200.4, audio_minutes: 55, meetings: 3 }], error: null }
    return { data: null, error: null }
  })
}
const page = () =>
  render(
    <I18nProvider>
      <MemoryRouter>
        <AdminUsage />
      </MemoryRouter>
    </I18nProvider>,
  )

describe('AdminUsage', () => {
  it('shows today against the cap, the state, the free allowance and no charge when under it', async () => {
    serve({ used: 3200, cap: 8000, free: 10000 })
    page()
    expect(await screen.findByText('3,200 of 8,000 AI units')).toBeTruthy()
    expect(screen.getByText(/Running normally/)).toBeTruthy()
    expect(screen.getByText(/Free allowance: 10,000 units a day/)).toBeTruthy()
    expect(screen.getByText(/No charge expected/)).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3200')
  })

  it('warns as the cap approaches', async () => {
    serve({ used: 6000, cap: 8000, free: 10000 })
    page()
    expect(await screen.findByText(/Close to the daily cap/)).toBeTruthy()
  })

  it('says processing is paused when the cap is reached, and the meter never overflows', async () => {
    serve({ used: 9500, cap: 8000, free: 10000 })
    page()
    expect(await screen.findByText(/Paused: the daily limit is reached/)).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('8000') // clamped to the cap
  })

  it('estimates a charge only for usage beyond the free allowance', async () => {
    serve({ used: 12000, cap: 0, free: 10000 })
    page()
    expect(await screen.findByText(/Estimated charge today: \$0\.02/)).toBeTruthy() // 2,000 over x $0.011 per 1,000
    expect(screen.getByText(/no daily cap/)).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('lists the heaviest users and has the table twin of the chart', async () => {
    serve({ used: 100, cap: 8000, free: 10000 })
    const user = userEvent.setup()
    page()
    const section = await screen.findByRole('region', { name: 'Heaviest users' })
    expect(within(section).getByText('Ann · ann@x.co')).toBeTruthy()
    expect(within(section).getByText('2,200')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'View as table' }))
    expect(screen.getByRole('table', { name: 'AI units per day' })).toBeTruthy()
  })

  it('changing the period re-queries with that many days', async () => {
    serve({ used: 100, cap: 8000, free: 10000 })
    const user = userEvent.setup()
    page()
    await screen.findByText(/of 8,000 AI units/)
    await user.click(screen.getByRole('button', { name: 'Last 30 days' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_usage_daily', { days: 30 }))
    expect(rpc).toHaveBeenCalledWith('admin_usage_by_user', { days: 30 })
  })

  it('saves a new cap', async () => {
    serve({ used: 100, cap: 8000, free: 10000 })
    const user = userEvent.setup()
    page()
    const box = await screen.findByLabelText('Daily AI cap')
    await user.clear(box)
    await user.type(box, '5000')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_set_ai_cap', { new_cap: 5000 }))
    expect(await screen.findByText('Cap saved.')).toBeTruthy()
  })

  it('asks before turning the cap off, and does nothing if declined', async () => {
    serve({ used: 100, cap: 8000, free: 10000 })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    page()
    const box = await screen.findByLabelText('Daily AI cap')
    await user.clear(box)
    await user.type(box, '0')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(confirm).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalledWith('admin_set_ai_cap', expect.anything())
    confirm.mockRestore()
  })

  it('shows a clear error if the caller is not allowed', async () => {
    serve({ used: 0, cap: 0, free: 0, fail: true })
    page()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Could not load usage.'))
  })
})
