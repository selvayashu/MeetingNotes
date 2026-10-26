import { Link } from 'react-router-dom'
import LanguageSelect from '../components/LanguageSelect'
import Logo from '../components/Logo'
import { useI18n } from '../i18n/context'
import type { TKey } from '../i18n/translate'

const BENEFITS: { title: TKey; body: TKey }[] = [
  { title: 'landing.b1.title', body: 'landing.b1.body' },
  { title: 'landing.b2.title', body: 'landing.b2.body' },
  { title: 'landing.b3.title', body: 'landing.b3.body' },
  { title: 'landing.b4.title', body: 'landing.b4.body' },
]

const primary = 'rounded-full bg-indigo-600 px-5 py-3 text-center font-semibold text-white'
const secondary = 'rounded-2xl border border-slate-200 px-5 py-3 text-center font-semibold dark:border-slate-700'

/** Public front page for signed-out visitors. */
export default function Landing() {
  const { t } = useI18n()
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-2xl font-bold">
          <Logo variant="mark" className="h-8 w-auto" />
          MeetNotes
        </span>
        <div className="flex items-center gap-3">
          <Link to="/login" className="py-2 text-sm font-semibold text-indigo-600 underline dark:text-indigo-400">
            {t('landing.signIn')}
          </Link>
          <LanguageSelect />
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold leading-tight">{t('landing.tagline')}</h1>
        <p className="text-lg text-slate-600 dark:text-slate-300">{t('landing.lead')}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/login?mode=signup" className={primary}>
            {t('landing.getStarted')}
          </Link>
          <Link to="/sample" className={secondary}>
            {t('landing.trySample')}
          </Link>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('landing.approval')}</p>
      </section>

      <section aria-label={t('landing.tagline')} className="grid gap-3">
        {BENEFITS.map((b) => (
          <div key={b.title} className="card p-4">
            <h2 className="font-semibold">{t(b.title)}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t(b.body)}</p>
          </div>
        ))}
      </section>

      <footer className="flex flex-col gap-4 text-sm text-slate-500 dark:text-slate-400">
        <p>{t('landing.footer')}</p>
        <Logo variant="full" className="h-10 w-auto self-start" />
      </footer>
    </main>
  )
}
