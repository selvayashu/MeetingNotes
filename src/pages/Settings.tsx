import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import DataSection from '../components/DataSection'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/context'
import { UI_LANGS, type TKey, type UiLang } from '../i18n/translate'
import { authErrorKey } from '../lib/authErrors'
import { isStrongEnough } from '../lib/password'
import { supabase } from '../lib/supabase'
import { useTheme, type ThemePref } from '../theme'

const THEMES: ThemePref[] = ['system', 'light', 'dark']

function ChangePassword() {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ key: TKey; error: boolean } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!isStrongEnough(password)) return setMsg({ key: 'password.rules', error: true })
    if (password !== confirm) return setMsg({ key: 'password.mismatch', error: true })
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setMsg({ key: authErrorKey(error), error: true })
    setPassword('')
    setConfirm('')
    setMsg({ key: 'settings.passwordChanged', error: false })
  }

  const box = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900'
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
      <h3 className="font-medium">{t('settings.changePassword')}</h3>
      <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder={t('resetpw.new')} aria-label={t('resetpw.new')} className={box} />
      <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
        placeholder={t('resetpw.confirm')} aria-label={t('resetpw.confirm')} className={box} />
      <button disabled={busy} className="self-start rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
        {busy ? t('common.saving') : t('settings.changePassword')}
      </button>
      {msg && (
        <p role={msg.error ? 'alert' : 'status'} className={`text-sm ${msg.error ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {t(msg.key)}
        </p>
      )}
    </form>
  )
}

export default function Settings() {
  const { t, lang, setLang } = useI18n()
  const { user, signOut } = useAuth()
  const { pref, setPref } = useTheme()
  const [deleteAudio, setDeleteAudio] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    if (!user) return
    void supabase
      .from('profiles')
      .select('delete_audio_after_notes')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setDeleteAudio(data?.delete_audio_after_notes ?? false))
  }, [user])

  async function saveProfile(patch: Record<string, unknown>) {
    if (!user) return false
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
    setMsg(error ? { text: t('settings.saveFailed'), error: true } : { text: t('settings.saved'), error: false })
    return !error
  }

  async function onDeleteAudio(next: boolean) {
    setDeleteAudio(next)
    if (!(await saveProfile({ delete_audio_after_notes: next }))) setDeleteAudio(!next)
  }

  function onLang(l: UiLang) {
    setLang(l)
    void saveProfile({ preferred_language: l })
  }

  const box = 'rounded-lg border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('settings.title')}</h2>
        <Link to="/" className="text-sm text-indigo-600 underline dark:text-indigo-400">
          {t('detail.back')}
        </Link>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('settings.language')}</span>
        <select value={lang} onChange={(e) => onLang(e.target.value as UiLang)} className={box}>
          {UI_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t('settings.theme')}</legend>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((p) => (
            <label
              key={p}
              className={`cursor-pointer rounded-lg border px-2 py-2.5 text-center text-sm ${
                pref === p
                  ? 'border-indigo-600 bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'border-slate-300 dark:border-slate-700'
              }`}
            >
              <input type="radio" name="theme" value={p} checked={pref === p} onChange={() => setPref(p)} className="sr-only" />
              {t(`theme.${p}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={deleteAudio ?? false}
          disabled={deleteAudio === null}
          onChange={(e) => void onDeleteAudio(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <span>
          <span className="block font-medium">{t('settings.deleteAudio')}</span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">{t('settings.deleteAudioHelp')}</span>
        </span>
      </label>

      {msg && (
        <p role={msg.error ? 'alert' : 'status'} className={`text-sm ${msg.error ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {msg.text}
        </p>
      )}

      <ChangePassword />

      <DataSection />

      <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <p className="min-w-0 truncate text-sm text-slate-500 dark:text-slate-400">
          {t('settings.account', { email: user?.email ?? '' })}
        </p>
        <button onClick={signOut} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold dark:border-slate-700">
          {t('nav.signOut')}
        </button>
      </div>
    </div>
  )
}
