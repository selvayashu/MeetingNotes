// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ user: null as null | { id: string } }))
const supabase = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { signInWithPassword: vi.fn(), signUp: vi.fn() } }))
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user, clearRecovery: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../src/lib/supabase', () => ({ supabase }))

import Onboarding from '../src/components/Onboarding'
import { I18nProvider } from '../src/i18n/I18nProvider'
import { dictionaries } from '../src/i18n/translate'
import Landing from '../src/pages/Landing'
import Login from '../src/pages/Login'
import Sample from '../src/pages/Sample'

const wrap = (ui: React.ReactElement) => render(<I18nProvider><MemoryRouter>{ui}</MemoryRouter></I18nProvider>)

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  auth.user = null
  localStorage.clear()
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('landing page', () => {
  it('offers sign-up, sign-in and the sample, with the right destinations', () => {
    wrap(<Landing />)
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/login?mode=signup')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
    expect(screen.getByRole('link', { name: 'See a sample meeting' }).getAttribute('href')).toBe('/sample')
  })

  it('is honest: Tamil is called experimental, approval and AI mistakes are disclosed', () => {
    wrap(<Landing />)
    expect(screen.getByText(/Tamil is experimental/)).toBeTruthy()
    expect(screen.getByText(/approved by an administrator/)).toBeTruthy()
    expect(screen.getByText(/can contain mistakes/)).toBeTruthy()
  })

  it('switches language, and has a single h1', async () => {
    wrap(<Landing />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await userEvent.setup().selectOptions(screen.getByLabelText('Language'), 'hi')
    expect(screen.getByRole('link', { name: 'खाता बनाएँ' })).toBeTruthy()
  })
})

describe('sign-up deep link', () => {
  it('opens the sign-up form when the address says ?mode=signup', () => {
    window.history.replaceState({}, '', '/login?mode=signup')
    wrap(<Login />)
    expect(screen.getByRole('tab', { name: 'Create account', selected: true })).toBeTruthy()
    window.history.replaceState({}, '', '/')
  })
  it('opens sign-in by default', () => {
    wrap(<Login />)
    expect(screen.getByRole('tab', { name: 'Sign in', selected: true })).toBeTruthy()
  })
})

describe('sample meeting', () => {
  it('shows a clear "sample" banner and the summary and decisions first', () => {
    wrap(<Sample />)
    expect(screen.getByRole('note').textContent).toMatch(/This is a sample/)
    expect(screen.getByText('Product launch planning')).toBeTruthy()
    expect(screen.getByText('Launch the new website on Friday.')).toBeTruthy()
  })

  it('switches between summary, action items and transcript', async () => {
    const user = userEvent.setup()
    wrap(<Sample />)
    await user.click(screen.getByRole('tab', { name: 'Action items' }))
    expect(screen.getByText('Send the press release to the newsroom list')).toBeTruthy()
    expect(screen.getByText(/Owner: Priya · Due date: Thursday/)).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Transcript' }))
    const rows = within(screen.getByRole('tabpanel')).getAllByRole('listitem')
    expect(rows).toHaveLength(8)
    expect(rows[1].textContent).toMatch(/^01:25/)
  })

  it('never touches the database or the API', async () => {
    const user = userEvent.setup()
    wrap(<Sample />)
    for (const name of ['Action items', 'Transcript', 'Summary']) await user.click(screen.getByRole('tab', { name }))
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('sends signed-out visitors to sign up, and signed-in users to record', () => {
    wrap(<Sample />)
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/login?mode=signup')
    cleanup()
    auth.user = { id: 'u1' }
    wrap(<Sample />)
    expect(screen.getByRole('link', { name: 'Record my first meeting' }).getAttribute('href')).toBe('/record')
    expect(screen.queryByLabelText('Language')).toBeNull() // the app shell supplies the chrome
  })

  it('is fully translated (no key falls back to English)', () => {
    for (const lang of ['hi', 'ta'] as const) {
      for (const k of Object.keys(dictionaries.en).filter((x) => /^(sample|landing|onboarding)\./.test(x))) {
        expect(dictionaries[lang][k as keyof typeof dictionaries.en], `${lang}:${k}`).toBeTruthy()
        expect(dictionaries[lang][k as keyof typeof dictionaries.en], `${lang}:${k} still English`).not.toBe(dictionaries.en[k as keyof typeof dictionaries.en])
      }
    }
  })
})

describe('onboarding card', () => {
  it('lists the three steps with record and sample actions', () => {
    wrap(<Onboarding userId="u1" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Record my first meeting' }).getAttribute('href')).toBe('/record')
    expect(screen.getByRole('link', { name: 'Try the sample' }).getAttribute('href')).toBe('/sample')
  })

  it('stays dismissed for that user only', async () => {
    const user = userEvent.setup()
    const { unmount } = wrap(<Onboarding userId="u1" />)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Welcome to MeetNotes')).toBeNull()
    unmount()
    wrap(<Onboarding userId="u1" />)
    expect(screen.queryByText('Welcome to MeetNotes')).toBeNull()
    cleanup()
    wrap(<Onboarding userId="u2" />)
    expect(screen.getByText('Welcome to MeetNotes')).toBeTruthy()
  })

  it('still works when storage is unavailable', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    wrap(<Onboarding userId="u1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Welcome to MeetNotes')).toBeNull()
    get.mockRestore()
    set.mockRestore()
  })
})
