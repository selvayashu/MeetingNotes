import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/context'

const key = (userId: string) => `meetnotes.onboarding.dismissed.${userId}`

function wasDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) === '1'
  } catch {
    return false
  }
}

/** First-run guide shown on an empty dashboard. Dismissal is remembered per user on this device. */
export default function Onboarding({ userId }: { userId: string }) {
  const { t } = useI18n()
  const [hidden, setHidden] = useState(() => wasDismissed(userId))
  if (hidden) return null

  function dismiss() {
    try {
      localStorage.setItem(key(userId), '1')
    } catch {
      /* private mode: it just comes back next time */
    }
    setHidden(true)
  }

  return (
    <section aria-label={t('onboarding.title')} className="flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/40">
      <h3 className="text-lg font-semibold">{t('onboarding.title')}</h3>
      <p className="text-sm">{t('onboarding.intro')}</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>{t('onboarding.s1')}</li>
        <li>{t('onboarding.s2')}</li>
        <li>{t('onboarding.s3')}</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/record" className="rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white">
          {t('onboarding.record')}
        </Link>
        <Link to="/sample" className="rounded-lg border border-slate-300 px-4 py-2.5 font-semibold dark:border-slate-600">
          {t('onboarding.sample')}
        </Link>
        <button onClick={dismiss} className="ml-auto py-2 text-sm text-slate-500 underline dark:text-slate-400">
          {t('onboarding.dismiss')}
        </button>
      </div>
    </section>
  )
}
