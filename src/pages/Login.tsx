import { useState, type FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import { UI_LANGS, type UiLang } from '../i18n/translate'
import { supabase } from '../lib/supabase'

type Step = 'email' | 'code'

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-900'
const btnCls =
  'w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60'

export default function Login() {
  const { t, lang, setLang } = useI18n()
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
      <div className="flex items-start justify-between">
        <h1 className="text-3xl font-bold">MeetNotes</h1>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as UiLang)}
          aria-label="Language"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          {UI_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
            </option>
          ))}
        </select>
      </div>
      <p className="text-slate-500 dark:text-slate-400">{t('login.subtitle')}</p>
      <p className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900">{t('login.approvalNote')}</p>

      {step === 'email' ? (
        <form onSubmit={sendCode} className="flex flex-col gap-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            aria-label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
          <button disabled={busy} className={btnCls}>
            {busy ? t('login.sending') : t('login.sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="flex flex-col gap-3">
          <p className="text-sm">{t('login.sentTo', { email })}</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            placeholder="123456"
            aria-label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputCls + ' text-center tracking-widest'}
          />
          <button disabled={busy} className={btnCls}>
            {busy ? t('login.verifying') : t('login.verify')}
          </button>
          <button type="button" onClick={() => setStep('email')} className="text-sm text-slate-500 dark:text-slate-400 underline">
            {t('login.otherEmail')}
          </button>
        </form>
      )}

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <hr className="flex-1 border-slate-200 dark:border-slate-800" /> {t('login.or')}{' '}
        <hr className="flex-1 border-slate-200 dark:border-slate-800" />
      </div>
      <button
        onClick={google}
        className="w-full rounded-lg border border-slate-300 px-4 py-3 font-semibold dark:border-slate-700"
      >
        {t('login.google')}
      </button>

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </main>
  )
}
