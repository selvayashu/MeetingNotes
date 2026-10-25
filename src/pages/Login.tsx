import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Step = 'email' | 'code'

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-900'
const btnCls =
  'w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60'

export default function Login() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Sends both a 6-digit code and a magic link; the code works on installed PWAs too.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setStep('code')
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError(error.message)
  }

  async function google() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(error.message)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-4">
      <h1 className="text-3xl font-bold">MeetNotes</h1>
      <p className="text-slate-500">Sign in to record and summarise your meetings.</p>

      {step === 'email' ? (
        <form onSubmit={sendCode} className="flex flex-col gap-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
          <button disabled={busy} className={btnCls}>
            {busy ? 'Sending…' : 'Email me a sign-in code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="flex flex-col gap-3">
          <p className="text-sm">
            We sent a code to <b>{email}</b>. Enter it below, or tap the link in the email.
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputCls + ' text-center tracking-widest'}
          />
          <button disabled={busy} className={btnCls}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <button type="button" onClick={() => setStep('email')} className="text-sm text-slate-500 underline">
            Use a different email
          </button>
        </form>
      )}

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <hr className="flex-1" /> or <hr className="flex-1" />
      </div>
      <button
        onClick={google}
        className="w-full rounded-lg border border-slate-300 px-4 py-3 font-semibold dark:border-slate-700"
      >
        Continue with Google
      </button>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </main>
  )
}
