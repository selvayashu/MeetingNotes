// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isStrongEnough } from '../src/lib/password'
import { authErrorKey, isLinkError } from '../src/lib/authErrors'

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}))
const clearRecovery = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/supabase', () => ({ supabase: { auth } }))
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: null, clearRecovery, signOut: vi.fn() }) }))

import Login from '../src/pages/Login'
import ResetPassword from '../src/pages/ResetPassword'
import { I18nProvider } from '../src/i18n/I18nProvider'

const wrap = (ui: React.ReactNode) => <I18nProvider>{ui}</I18nProvider>
const GOOD = 'Sunrise2026'

beforeEach(() => {
  Object.values(auth).forEach((f) => f.mockReset())
  clearRecovery.mockReset()
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })
  auth.signUp.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null })
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
  auth.updateUser.mockResolvedValue({ data: {}, error: null })
  localStorage.clear()
  window.location.hash = ''
})
afterEach(cleanup)

describe('password rule', () => {
  it('needs 8+ characters with a letter and a digit (any script)', () => {
    expect(isStrongEnough('abc12345')).toBe(true)
    expect(isStrongEnough('கடவுச்சொல்1234')).toBe(true)
    expect(isStrongEnough('short1')).toBe(false)
    expect(isStrongEnough('onlyletters')).toBe(false)
    expect(isStrongEnough('12345678')).toBe(false)
    expect(isStrongEnough('')).toBe(false)
  })
})

describe('auth error mapping', () => {
  it('maps known Supabase errors to translated messages', () => {
    expect(authErrorKey({ code: 'invalid_credentials' })).toBe('login.badCredentials')
    expect(authErrorKey({ message: 'Invalid login credentials' })).toBe('login.badCredentials')
    expect(authErrorKey({ code: 'user_already_exists' })).toBe('login.alreadyExists')
    expect(authErrorKey({ code: 'weak_password' })).toBe('password.rules')
    expect(authErrorKey({ code: 'over_email_send_rate_limit' })).toBe('login.rateLimited')
    expect(authErrorKey({ status: 429 })).toBe('login.rateLimited')
    expect(authErrorKey({ message: 'kaboom internal detail' })).toBe('login.genericError')
  })
  it('recognises dead e-mail links in the URL', () => {
    expect(isLinkError('#error=access_denied&error_code=otp_expired&error_description=x')).toBe(true)
    expect(isLinkError('#access_token=abc&type=recovery')).toBe(false)
    expect(isLinkError('')).toBe(false)
  })
})

describe('Login: sign in', () => {
  it('signs in with e-mail and password', async () => {
    const user = userEvent.setup()
    render(wrap(<Login />))
    await user.type(screen.getByLabelText('Email'), '  me@x.co ')
    await user.type(screen.getByLabelText('Password'), GOOD)
    await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }))
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@x.co', password: GOOD }))
  })

  it('shows a friendly message, never the raw server text', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
    const user = userEvent.setup()
    render(wrap(<Login />))
    await user.type(screen.getByLabelText('Email'), 'me@x.co')
    await user.type(screen.getByLabelText('Password'), 'wrong-pass1')
    await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Incorrect email or password.')
  })

  it('can reveal the password', async () => {
    const user = userEvent.setup()
    render(wrap(<Login />))
    const pw = screen.getByLabelText('Password') as HTMLInputElement
    expect(pw.type).toBe('password')
    await user.click(screen.getByLabelText('Show password'))
    expect(pw.type).toBe('text')
  })
})

describe('Login: create account', () => {
  async function openSignup() {
    const user = userEvent.setup()
    render(wrap(<Login />))
    await user.click(screen.getByRole('tab', { name: 'Create account' }))
    return user
  }

  it('asks for name, e-mail and password, and mentions admin approval', async () => {
    await openSignup()
    expect(screen.getByLabelText('Full name')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByText(/approved by an administrator/i)).toBeTruthy()
  })

  it('sends the name as profile metadata', async () => {
    const user = await openSignup()
    await user.type(screen.getByLabelText('Full name'), '  Priya Raman ')
    await user.type(screen.getByLabelText('Email'), 'priya@x.co')
    await user.type(screen.getByLabelText('Password'), GOOD)
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }))
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1))
    expect(auth.signUp.mock.calls[0][0]).toMatchObject({
      email: 'priya@x.co',
      password: GOOD,
      options: { data: { full_name: 'Priya Raman' } },
    })
  })

  it('rejects a weak password locally without calling the server', async () => {
    const user = await openSignup()
    await user.type(screen.getByLabelText('Full name'), 'Priya')
    await user.type(screen.getByLabelText('Email'), 'priya@x.co')
    await user.type(screen.getByLabelText('Password'), 'weak')
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Use at least 8 characters, with letters and numbers.')
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('rejects a blank name', async () => {
    const user = await openSignup()
    await user.type(screen.getByLabelText('Full name'), '   ')
    await user.type(screen.getByLabelText('Email'), 'priya@x.co')
    await user.type(screen.getByLabelText('Password'), GOOD)
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Please enter your name.')
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('explains an already-registered e-mail', async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: { code: 'user_already_exists', message: 'User already registered' } })
    const user = await openSignup()
    await user.type(screen.getByLabelText('Full name'), 'Priya')
    await user.type(screen.getByLabelText('Email'), 'priya@x.co')
    await user.type(screen.getByLabelText('Password'), GOOD)
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('already exists'))
  })

  it('asks to confirm by e-mail if the project requires it (no session returned)', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null })
    const user = await openSignup()
    await user.type(screen.getByLabelText('Full name'), 'Priya')
    await user.type(screen.getByLabelText('Email'), 'priya@x.co')
    await user.type(screen.getByLabelText('Password'), GOOD)
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Check your email'))
  })
})

describe('Login: forgot password', () => {
  async function openForgot() {
    const user = userEvent.setup()
    render(wrap(<Login />))
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    return user
  }

  it('requests a reset link that returns to this site', async () => {
    const user = await openForgot()
    expect(screen.queryByLabelText('Password')).toBeNull() // only the e-mail field
    await user.type(screen.getByLabelText('Email'), 'me@x.co')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('me@x.co', { redirectTo: window.location.origin }))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('If an account exists'))
  })

  it('gives the same answer for an unknown e-mail (no account probing)', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { code: 'user_not_found', message: 'nope', status: 400 } })
    const user = await openForgot()
    await user.type(screen.getByLabelText('Email'), 'ghost@x.co')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('If an account exists'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does tell the user when they are being rate-limited', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { code: 'over_email_send_rate_limit', message: 'x', status: 429 } })
    const user = await openForgot()
    await user.type(screen.getByLabelText('Email'), 'me@x.co')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Too many attempts'))
  })

  it('opens on the reset form with an explanation when the e-mail link was dead', () => {
    window.location.hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    render(wrap(<Login />))
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveProperty('textContent', expect.stringContaining('expired'))
  })
})

describe('ResetPassword (after clicking the e-mail link)', () => {
  const fill = async (a: string, b: string) => {
    const user = userEvent.setup()
    render(wrap(<ResetPassword />))
    await user.type(screen.getByLabelText('New password'), a)
    await user.type(screen.getByLabelText('Confirm new password'), b)
    await user.click(screen.getByRole('button', { name: 'Save new password' }))
    return user
  }

  it('blocks mismatched passwords', async () => {
    await fill(GOOD, GOOD + 'x')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The two passwords do not match.')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('blocks a weak password', async () => {
    await fill('weakpass', 'weakpass')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('at least 8'))
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('saves the new password, confirms, and lets the user continue', async () => {
    const user = await fill(GOOD, GOOD)
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: GOOD }))
    expect(await screen.findByText('Your password has been changed.')).toBeTruthy()
    expect(clearRecovery).not.toHaveBeenCalled() // only after the user continues
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(clearRecovery).toHaveBeenCalledTimes(1)
  })

  it('shows a mapped error if the server refuses (e.g. same/weak password)', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: { code: 'weak_password', message: 'Password is known to be weak' } })
    await fill(GOOD, GOOD)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('at least 8'))
  })
})
