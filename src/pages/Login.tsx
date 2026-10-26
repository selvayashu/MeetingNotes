import { useState, type FormEvent } from 'react'
import Logo from '../components/Logo'
import { useI18n } from '../i18n/context'
import { UI_LANGS, type TKey, type UiLang } from '../i18n/translate'
import { authErrorKey, isLinkError } from '../lib/authErrors'
import { isStrongEnough } from '../lib/password'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'forgot'

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-900'
const btnCls =
  'w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60'

export default function Login() {
  const { t, lang, setLang } = useI18n()
  // A dead password-reset link lands here with an error in the URL: send the user straight to "forgot".
  const linkBroken = typeof window !== 'undefined' && isLinkError(window.location.hash + window.location.search)
  const [mode, setMode] = useState<Mode>(
    linkBroken ? 'forgot' : typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'signin',
  )
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TKey | null>(linkBroken ? 'login.linkExpired' : null)
  const [notice, setNotice] = useState<TKey | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const addr = email.trim()

    if (mode === 'signup') {
      if (!name.trim()) return setError('login.nameRequired')
      if (!isStrongEnough(password)) return setError('password.rules')
    }

    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password })
        if (error) setError(authErrorKey(error))
        // On success the auth listener swaps this screen out; approval is checked by the app shell.
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: addr,
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin },
        })
        if (error) setError(authErrorKey(error))
        else if (!data.session) {
          // Only happens if the project requires e-mail confirmation.
          setNotice('login.checkEmailConfirm')
          setMode('signin')
        }
        // With a session, the shell shows the "waiting for approval" screen.
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: window.location.origin })
        // Same message whether or not the account exists, so the form can't be used to probe for emails.
        if (error && authErrorKey(error) === 'login.rateLimited') setError('login.rateLimited')
        else setNotice('login.resetSent')
      }
    } catch {
      setError('login.genericError')
    } finally {
      setBusy(false)
    }
  }

  const tab = (m: 'signin' | 'signup', label: TKey) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => switchMode(m)}
      className={`flex-1 border-b-2 px-2 py-3 text-sm font-semibold ${
        mode === m
          ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
          : 'border-transparent text-slate-500 dark:text-slate-400'
      }`}
    >
      {t(label)}
    </button>
  )

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-4 py-8">
      <Logo variant="full" className="h-14 w-auto self-start" />
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

      {mode !== 'forgot' ? (
        <div role="tablist" className="flex border-b border-slate-200 dark:border-slate-800">
          {tab('signin', 'login.tabSignIn')}
          {tab('signup', 'login.signUp')}
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-semibold">{t('login.resetTitle')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('login.resetHelp')}</p>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === 'signup' && (
          <input
            type="text"
            required
            maxLength={100}
            autoComplete="name"
            placeholder={t('login.name')}
            aria-label={t('login.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        )}
        <input
          type="email"
          required
          autoComplete={mode === 'signin' ? 'username' : 'email'}
          placeholder={t('login.email')}
          aria-label={t('login.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
        {mode !== 'forgot' && (
          <>
            <input
              type={show ? 'text' : 'password'}
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={t('login.password')}
              aria-label={t('login.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4" />
              {t('login.showPassword')}
            </label>
          </>
        )}
        {mode === 'signup' && <p className="text-xs text-slate-500 dark:text-slate-400">{t('password.rules')}</p>}

        <button disabled={busy} className={btnCls}>
          {mode === 'signin' && (busy ? t('login.signingIn') : t('login.signIn'))}
          {mode === 'signup' && (busy ? t('login.signingUp') : t('login.signUp'))}
          {mode === 'forgot' && (busy ? t('login.sending') : t('login.sendLink'))}
        </button>
      </form>

      {mode === 'signup' && (
        <p className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900">{t('login.approvalNote')}</p>
      )}
      {mode === 'signin' && (
        <button type="button" onClick={() => switchMode('forgot')} className="self-start py-1 text-sm text-indigo-600 underline dark:text-indigo-400">
          {t('login.forgot')}
        </button>
      )}
      {mode === 'forgot' && (
        <button type="button" onClick={() => switchMode('signin')} className="self-start py-1 text-sm text-indigo-600 underline dark:text-indigo-400">
          {t('login.backToSignIn')}
        </button>
      )}

      {notice && (
        <p role="status" className="rounded-lg bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
          {t(notice)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t(error)}
        </p>
      )}
    </main>
  )
}
