// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ActionItem, Segment } from '../src/lib/types'

// ---- fake Supabase query builder: records calls, resolves with a configurable result ----
const db = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; payload?: unknown; eq?: [string, unknown] }[],
  result: { data: null as unknown, error: null as null | { message: string } },
}))
vi.mock('../src/lib/supabase', () => {
  const builder = (table: string, op: string, payload?: unknown) => {
    const entry: (typeof db.calls)[number] = { table, op, payload }
    db.calls.push(entry)
    const b: Record<string, unknown> = {
      eq: (col: string, val: unknown) => ((entry.eq = [col, val]), b),
      select: () => b,
      single: () => Promise.resolve(db.result),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(db.result).then(res, rej),
    }
    return b
  }
  return {
    supabase: {
      from: (table: string) => ({
        update: (p: unknown) => builder(table, 'update', p),
        insert: (p: unknown) => builder(table, 'insert', p),
        delete: () => builder(table, 'delete'),
      }),
    },
  }
})

import TranscriptTab from '../src/components/TranscriptTab'
import ActionItemsTab from '../src/components/ActionItemsTab'

beforeEach(() => {
  db.calls.length = 0
  db.result = { data: null, error: null }
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

const segments: Segment[] = [
  { id: '1', start_ms: 0, end_ms: 4000, text: 'Good morning everyone' },
  { id: '2', start_ms: 65_000, end_ms: 70_000, text: 'Launch the website on Friday' },
  { id: '3', start_ms: 130_000, end_ms: 135_000, text: 'வெள்ளிக்கிழமை வெளியிடுவது என்று முடிவு' },
]

describe('TranscriptTab', () => {
  const setup = (props: Partial<Parameters<typeof TranscriptTab>[0]> = {}) => {
    const onSeek = vi.fn()
    render(<TranscriptTab segments={segments} currentMs={0} playing={false} canSeek onSeek={onSeek} {...props} />)
    return { onSeek, user: userEvent.setup() }
  }

  it('seeks to a segment start when clicked', async () => {
    const { onSeek, user } = setup()
    await user.click(screen.getByText('Launch the website on Friday'))
    expect(onSeek).toHaveBeenCalledWith(65_000)
  })

  it('filters by search and highlights the match, case-insensitively', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText('Search transcript'), 'FRIDAY')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText('Friday', { selector: 'mark' })).toBeTruthy()
    expect(screen.getByText('1 match')).toBeTruthy()
  })

  it('searches Tamil text and treats regex characters literally', async () => {
    const { user } = setup()
    const box = screen.getByLabelText('Search transcript')
    await user.type(box, 'வெள்ளி')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await user.clear(box)
    await user.type(box, '(.*')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('0 matches')).toBeTruthy()
  })

  it('marks the segment being spoken and disables seeking without audio', () => {
    setup({ currentMs: 66_000 })
    const active = screen.getByText('Launch the website on Friday').closest('button')!
    expect(active.className).toContain('bg-indigo-50')
    cleanup()
    setup({ canSeek: false })
    expect((screen.getByText('Good morning everyone').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ActionItemsTab', () => {
  const items: ActionItem[] = [
    { id: 'a', task: 'Press release', owner: 'Priya', due_date: '2026-10-28', is_done: false },
    { id: 'b', task: 'Confirm budget', owner: null, due_date: null, is_done: false },
  ]
  function Harness() {
    const [list, setList] = useState(items)
    return (
      <>
        <ActionItemsTab meetingId="m1" items={list} onChange={setList} />
        <output data-testid="done">{list.filter((i) => i.is_done).map((i) => i.id).join(',')}</output>
      </>
    )
  }

  it('ticking an item updates it optimistically and saves', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByLabelText('Mark done: Press release'))
    expect(screen.getByTestId('done').textContent).toBe('a')
    await waitFor(() => expect(db.calls).toHaveLength(1))
    expect(db.calls[0]).toMatchObject({ table: 'action_items', op: 'update', payload: { is_done: true }, eq: ['id', 'a'] })
  })

  it('rolls the checkbox back and shows the error if the save fails', async () => {
    db.result = { data: null, error: { message: 'permission denied' } }
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByLabelText('Mark done: Press release'))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'permission denied')
    expect(screen.getByTestId('done').textContent).toBe('')
  })

  it('saves an edited task on blur, but not an unchanged or emptied one', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const task = screen.getAllByLabelText('Task')[0] as HTMLInputElement
    await user.click(task)
    await user.tab() // blur, unchanged
    expect(db.calls).toHaveLength(0)
    await user.clear(task)
    await user.tab() // blur, empty: restored, not saved
    expect(task.value).toBe('Press release')
    expect(db.calls).toHaveLength(0)
    await user.type(task, '!')
    await user.tab()
    await waitFor(() => expect(db.calls).toHaveLength(1))
    expect(db.calls[0].payload).toEqual({ task: 'Press release!' })
  })

  it('adds a new item and deletes one', async () => {
    db.result = { data: { id: 'c', task: 'Book room', owner: null, due_date: null, is_done: false }, error: null }
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByLabelText('New action item'), 'Book room')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByDisplayValue('Book room')).toBeTruthy()
    expect(db.calls[0]).toMatchObject({ op: 'insert', payload: { meeting_id: 'm1', task: 'Book room' } })

    await user.click(screen.getByLabelText('Delete: Confirm budget'))
    const list = screen.getAllByRole('listitem')
    expect(list.some((li) => within(li).queryByDisplayValue('Confirm budget'))).toBe(false)
    expect(db.calls.at(-1)).toMatchObject({ op: 'delete', eq: ['id', 'b'] })
  })
})
