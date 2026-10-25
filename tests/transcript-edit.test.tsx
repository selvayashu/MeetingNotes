// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { notesAreStale, planReplace, replaceInText } from '../src/lib/transcriptEdit'
import type { Segment } from '../src/lib/types'

// ---- stand-in for the database: remembers each line and applies the same rules as the trigger ----
const server = vi.hoisted(() => ({
  rows: new Map<string, { text: string; original_text: string | null; edited_at: string | null }>(),
  calls: [] as { id: string; text: string }[],
  failIds: new Set<string>(),
}))
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (payload: { text: string }) => {
        const call = { id: '', text: payload.text }
        server.calls.push(call)
        const b = {
          eq: (_col: string, id: string) => ((call.id = id), b),
          select: () => b,
          single: () => {
            if (server.failIds.has(call.id)) return Promise.resolve({ data: null, error: { message: 'boom' } })
            const row = server.rows.get(call.id)!
            if (call.text !== row.text) {
              const original = row.original_text ?? row.text
              row.original_text = call.text === original ? null : original
              row.edited_at = call.text === original ? null : new Date().toISOString()
              row.text = call.text
            }
            return Promise.resolve({ data: { id: call.id, ...row }, error: null })
          },
        }
        return b
      },
    }),
  },
}))

import TranscriptTab from '../src/components/TranscriptTab'
import { I18nProvider } from '../src/i18n/I18nProvider'

const seg = (id: string, ms: number, text: string): Segment => ({ id, start_ms: ms, end_ms: ms + 3000, text, original_text: null, edited_at: null })
const initial = [seg('a', 0, 'Prya will send the report'), seg('b', 5000, 'Thanks all'), seg('c', 9000, 'Prya agreed to the date')]

function Harness() {
  const [segments, setSegments] = useState(initial)
  return (
    <I18nProvider>
      <TranscriptTab segments={segments} currentMs={0} playing={false} canSeek={false} onSeek={() => {}} onChange={setSegments} />
    </I18nProvider>
  )
}

beforeEach(() => {
  server.rows = new Map(initial.map((s) => [s.id, { text: s.text, original_text: null, edited_at: null }]))
  server.calls = []
  server.failIds = new Set()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const editButton = (ts: string) => screen.getByRole('button', { name: new RegExp(`^Edit line ${ts}`) })

describe('replace / staleness helpers', () => {
  it('replaces case-insensitively and literally', () => {
    expect(replaceInText('Prya and PRYA', 'prya', 'Priya')).toBe('Priya and Priya')
    expect(replaceInText('cost is $5 (approx.)', '(approx.)', '$&')).toBe('cost is $5 $&') // no regex or $-token surprises
    expect(replaceInText('anything', '', 'x')).toBe('anything')
    expect(replaceInText('கூட்டம் முடிந்தது', 'கூட்டம்', 'சந்திப்பு')).toBe('சந்திப்பு முடிந்தது')
  })

  it('plans only the lines that change, and skips ones that would become empty', () => {
    const plan = planReplace([...initial, seg('d', 12000, 'Prya')], 'prya', 'Priya')
    expect(plan.edits.map((e) => e.id)).toEqual(['a', 'c', 'd'])
    expect(planReplace([seg('d', 0, 'Prya')], 'prya', '')).toEqual({ edits: [], skipped: 1 })
    expect(planReplace(initial, 'zzz', 'y').edits).toEqual([])
    expect(planReplace(initial, '', 'y').edits).toEqual([])
  })

  it('knows when notes are older than the latest edit', () => {
    const gen = '2026-10-25T10:00:00Z'
    expect(notesAreStale([{ edited_at: null }], gen)).toBe(false)
    expect(notesAreStale([{ edited_at: '2026-10-25T09:59:00Z' }], gen)).toBe(false) // edit was before the notes
    expect(notesAreStale([{ edited_at: '2026-10-25T10:05:00Z' }, { edited_at: null }], gen)).toBe(true)
    expect(notesAreStale([{ edited_at: '2026-10-25T10:05:00Z' }], null)).toBe(false) // no notes yet
  })
})

describe('editing a line', () => {
  it('saves the new text, shows an "edited" marker, and keeps the original available', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(editButton('00:00'))
    const box = screen.getByRole('textbox', { name: 'Edit line' })
    await user.clear(box)
    await user.type(box, 'Priya will send the report')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(server.calls).toEqual([{ id: 'a', text: 'Priya will send the report' }]))
    expect(await screen.findByText('Priya will send the report')).toBeTruthy()
    expect(screen.getByText('edited')).toBeTruthy()

    await user.click(editButton('00:00'))
    expect(screen.getByText('Original: Prya will send the report')).toBeTruthy()
  })

  it('"Restore original" puts Whisper\'s text back and removes the marker', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(editButton('00:00'))
    await user.clear(screen.getByRole('textbox', { name: 'Edit line' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit line' }), 'Changed')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('edited')

    await user.click(editButton('00:00'))
    await user.click(screen.getByRole('button', { name: 'Restore original' }))
    expect(await screen.findByText('Prya will send the report')).toBeTruthy()
    expect(screen.queryByText('edited')).toBeNull()
  })

  it('does not call the server for an unchanged line, and refuses an empty one', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(editButton('00:05'))
    await user.click(screen.getByRole('button', { name: 'Save' })) // nothing changed
    expect(server.calls).toHaveLength(0)

    await user.click(editButton('00:05'))
    await user.clear(screen.getByRole('textbox', { name: 'Edit line' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "A line can't be empty.")
    expect(server.calls).toHaveLength(0)
  })

  it('Esc cancels and Ctrl+Enter saves', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(editButton('00:05'))
    await user.type(screen.getByRole('textbox', { name: 'Edit line' }), ' everyone{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Edit line' })).toBeNull()
    expect(server.calls).toHaveLength(0)

    await user.click(editButton('00:05'))
    await user.type(screen.getByRole('textbox', { name: 'Edit line' }), ' everyone{Control>}{Enter}{/Control}')
    await waitFor(() => expect(server.calls).toEqual([{ id: 'b', text: 'Thanks all everyone' }]))
  })

  it('keeps the editor open with a message when saving fails', async () => {
    server.failIds.add('b')
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(editButton('00:05'))
    await user.type(screen.getByRole('textbox', { name: 'Edit line' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not save the change.')
    expect(screen.getByRole('textbox', { name: 'Edit line' })).toBeTruthy()
  })
})

describe('replace all', () => {
  const search = async (user: ReturnType<typeof userEvent.setup>, find: string, to: string) => {
    await user.type(screen.getByLabelText('Search transcript'), find)
    await user.type(screen.getByLabelText('Replace with'), to)
  }

  it('fixes a repeated mistake across lines after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<Harness />)
    await search(user, 'prya', 'Priya')
    await user.click(screen.getByRole('button', { name: 'Replace all (2)' }))

    await waitFor(() => expect(server.calls.map((c) => c.id).sort()).toEqual(['a', 'c']))
    expect(window.confirm).toHaveBeenCalledWith('Replace “prya” with “Priya” in 2 lines?')
    expect(await screen.findByText('Replaced in 2 lines.')).toBeTruthy()
    expect(screen.getByText('Priya will send the report')).toBeTruthy()
    expect(screen.getByText('Priya agreed to the date')).toBeTruthy()
    expect(screen.getByText('Thanks all')).toBeTruthy() // untouched
  })

  it('does nothing if the user declines', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<Harness />)
    await search(user, 'prya', 'Priya')
    await user.click(screen.getByRole('button', { name: 'Replace all (2)' }))
    expect(server.calls).toHaveLength(0)
  })

  it('reports lines that could not be changed instead of hiding them', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    server.failIds.add('c')
    const user = userEvent.setup()
    render(<Harness />)
    await search(user, 'prya', 'Priya')
    await user.click(screen.getByRole('button', { name: 'Replace all (2)' }))
    const msg = await screen.findByRole('status')
    expect(within(msg).getByText(/Replaced in 1 lines\. 1 lines could not be changed\./)).toBeTruthy()
  })

  it('is disabled when the replacement would change nothing, enabled when it would', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByLabelText('Search transcript'), 'Prya')
    const btn = () => screen.getByRole('button', { name: /Replace all/ }) as HTMLButtonElement
    await user.type(screen.getByLabelText('Replace with'), 'Prya') // same text
    expect(btn().disabled).toBe(true)
    await user.clear(screen.getByLabelText('Replace with')) // deleting the word is a real change
    expect(btn().disabled).toBe(false)
  })
})
