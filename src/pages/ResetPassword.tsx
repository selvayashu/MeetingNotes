import { useState, type FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/context'
import type { TKey } from '../i18n/translate'
import { authErrorKey } from '../lib/authErrors'
import { isStrongEnough } from '../lib/password'
import { supabase } from '../lib/supabase'

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-900'

/** Shown after the user opens the link from the "reset password" e-mail. */
export default function ResetPassword() {
  const { t } = useI18n()
  const { clearRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TKey | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isStrongEnough(password)) return setError('password.rules')
    if (password !== confirm) return setError('password.mismatch')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(authErrorKey(error))
    else setDone(true)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">{t('resetpw.title')}</h1>
      {done ? (
        <>
          <p role="status" className="rounded-lg bg-emerald-100 p-3 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
            {t('resetpw.done')}
          </p>
          <button onClick={clearRecovery} className="rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white">
            {t('login.tabSignIn')}
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder={t('resetpw.new')}
            aria-label={t('resetpw.new')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder={t('resetpw.confirm')}
            aria-label={t('resetpw.confirm')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputCls}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('password.rules')}</p>
          <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60">
            {busy ? t('resetpw.saving') : t('resetpw.save')}
          </button>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {t(error)}
            </p>
          )}
        </form>
      )}
    </main>
  )
}
