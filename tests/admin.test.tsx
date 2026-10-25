// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc } }))
vi.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'new@user.co' }, signOut: vi.fn() }),
}))

import Admin from '../src/pages/Admin'
import PendingApproval from '../src/pages/PendingApproval'
import { I18nProvider } from '../src/i18n/I18nProvider'

const users = [
  { id: 'p1', email: 'waiting@x.co', full_name: null, status: 'pending', is_admin: false, created_at: '2026-10-25T01:00:00Z' },
  { id: 'a1', email: 'boss@x.co', full_name: null, status: 'approved', is_admin: true, created_at: '2026-10-20T01:00:00Z' },
  { id: 'a2', email: 'ok@x.co', full_name: null, status: 'approved', is_admin: false, created_at: '2026-10-21T01:00:00Z' },
  { id: 'r1', email: 'nope@x.co', full_name: null, status: 'rejected', is_admin: false, created_at: '2026-10-22T01:00:00Z' },
]

const wrap = (ui: React.ReactNode) => (
  <I18nProvider>
    <MemoryRouter>{ui}</MemoryRouter>
  </I18nProvider>
)

beforeEach(() => {
  rpc.mockReset()
  rpc.mockImplementation((name: string) =>
    Promise.resolve(name === 'admin_list_users' ? { data: users, error: null } : { data: null, error: null }),
  )
})
afterEach(cleanup)

describe('Admin page', () => {
  it('groups users by status with counts', async () => {
    render(wrap(<Admin />))
    const pending = await screen.findByRole('region', { name: 'Waiting for approval' })
    expect(within(pending).getByText('waiting@x.co')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Approved users' })).getByText('ok@x.co')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Rejected' })).getByText('nope@x.co')).toBeTruthy()
    expect(screen.getByText('(2)')).toBeTruthy() // two approved
  })

  it('approving calls the RPC with the right user and refreshes the list', async () => {
    const user = userEvent.setup()
    render(wrap(<Admin />))
    const pending = await screen.findByRole('region', { name: 'Waiting for approval' })
    await user.click(within(pending).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_set_status', { target: 'p1', new_status: 'approved' }))
    await waitFor(() => expect(rpc.mock.calls.filter((c) => c[0] === 'admin_list_users').length).toBe(2))
  })

  it('rejecting and revoking use the rejected status', async () => {
    const user = userEvent.setup()
    render(wrap(<Admin />))
    const pending = await screen.findByRole('region', { name: 'Waiting for approval' })
    await user.click(within(pending).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_set_status', { target: 'p1', new_status: 'rejected' }))
    await user.click(within(screen.getByRole('region', { name: 'Approved users' })).getByRole('button', { name: 'Revoke access' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_set_status', { target: 'a2', new_status: 'rejected' }))
  })

  it('offers no buttons on admin accounts, and lets a rejected user be re-approved', async () => {
    render(wrap(<Admin />))
    const approved = await screen.findByRole('region', { name: 'Approved users' })
    const bossRow = within(approved).getByText('boss@x.co').closest('li')!
    expect(within(bossRow).queryAllByRole('button')).toHaveLength(0)
    expect(within(bossRow).getByText('Admin')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Rejected' })).getByRole('button', { name: 'Approve' })).toBeTruthy()
  })

  it('shows an error when the caller is not an admin', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not authorized' } })
    render(wrap(<Admin />))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'not authorized')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('shows a friendly error if an update fails', async () => {
    const user = userEvent.setup()
    render(wrap(<Admin />))
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'admin_list_users' ? { data: users, error: null } : { data: null, error: { message: 'boom' } }),
    )
    const pending = await screen.findByRole('region', { name: 'Waiting for approval' })
    await user.click(within(pending).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not update the user.')
  })
})

describe('PendingApproval screen', () => {
  it('tells a pending user to wait and lets them re-check', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(wrap(<PendingApproval status="pending" refresh={refresh} />))
    expect(screen.getByText('Waiting for approval')).toBeTruthy()
    expect(screen.getByText(/new@user\.co/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('rejected users get a clear message and no re-check button', () => {
    render(wrap(<PendingApproval status="rejected" refresh={vi.fn()} />))
    expect(screen.getByText('Access not granted')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })
})
