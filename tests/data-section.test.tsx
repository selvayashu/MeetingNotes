// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const supabase = vi.hoisted(() => ({ auth: { getSession: vi.fn(), signOut: vi.fn() } }))
const exporter = vi.hoisted(() => ({ exportAllData: vi.fn(), clearLocalData: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase }))
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'ann@example.com' } }) }))
vi.mock('../src/lib/dataExport', () => exporter)

import DataSection from '../src/components/DataSection'
import { I18nProvider } from '../src/i18n/I18nProvider'

const page = () => render(<I18nProvider><DataSection /></I18nProvider>)
const fetchMock = vi.fn()
const assign = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  supabase.auth.signOut.mockResolvedValue({})
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true })
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('export', () => {
  it('downloads the file and says how many meetings it holds', async () => {
    exporter.exportAllData.mockResolvedValue({ blob: new Blob(['x']), filename: 'meetnotes-export-2026-10-28.zip', meetings: 3, missingAudio: 0 })
    page()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download my data' }))
    expect(await screen.findByText('Done. 3 meetings were saved to a file.')).toBeTruthy()
    expect(exporter.exportAllData).toHaveBeenCalledWith('u1', 'ann@example.com', expect.objectContaining({ includeAudio: false }))
  })

  it('includes audio only when ticked, and warns about files that could not be fetched', async () => {
    exporter.exportAllData.mockResolvedValue({ blob: new Blob(['x']), filename: 'f.zip', meetings: 2, missingAudio: 1 })
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Download my data' }))
    expect(await screen.findByText(/1 audio files could not be downloaded/)).toBeTruthy()
    expect(exporter.exportAllData).toHaveBeenCalledWith('u1', 'ann@example.com', expect.objectContaining({ includeAudio: true }))
  })

  it('shows an error if preparing fails', async () => {
    exporter.exportAllData.mockRejectedValue(new Error('x'))
    page()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download my data' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not prepare your data. Please try again.')
  })
})

describe('delete account', () => {
  const del = () => screen.getByRole('button', { name: 'Delete my account' })

  it('stays disabled until the exact e-mail is typed', async () => {
    const user = userEvent.setup()
    page()
    expect((del() as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Type your e-mail to confirm'), 'ann@exampl')
    expect((del() as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Type your e-mail to confirm'), 'e.com')
    expect((del() as HTMLButtonElement).disabled).toBe(false)
  })

  it('deletes on the server with the session token, wipes this device, signs out and leaves', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const user = userEvent.setup()
    page()
    await user.type(screen.getByLabelText('Type your e-mail to confirm'), 'ann@example.com')
    await user.click(del())
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(fetchMock).toHaveBeenCalledWith('/api/delete-account', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      body: JSON.stringify({ email: 'ann@example.com' }),
    }))
    expect(exporter.clearLocalData).toHaveBeenCalled()
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('on failure shows the server message, keeps the data on this device and stays signed in', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'You are the only administrator.' }) })
    const user = userEvent.setup()
    page()
    await user.type(screen.getByLabelText('Type your e-mail to confirm'), 'ann@example.com')
    await user.click(del())
    expect((await screen.findByRole('alert')).textContent).toBe('You are the only administrator.')
    expect(exporter.clearLocalData).not.toHaveBeenCalled()
    expect(supabase.auth.signOut).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
    expect((del() as HTMLButtonElement).disabled).toBe(false) // can try again
  })
})
