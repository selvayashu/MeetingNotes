import { useState } from 'react'
import { Link } from 'react-router-dom'
import LanguageSelect from '../components/LanguageSelect'
import Logo from '../components/Logo'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/context'
import type { TKey } from '../i18n/translate'

type Tab = 'summary' | 'actions' | 'transcript'
const TABS: { id: Tab; key: TKey }[] = [
  { id: 'summary', key: 'tabs.summary' },
  { id: 'actions', key: 'tabs.actions' },
  { id: 'transcript', key: 'tabs.transcript' },
]
const DECISIONS: TKey[] = ['sample.decision1', 'sample.decision2', 'sample.decision3']
const ACTIONS: { task: TKey; owner: TKey; due: TKey }[] = [
  { task: 'sample.action1.task', owner: 'sample.action1.owner', due: 'sample.action1.due' },
  { task: 'sample.action2.task', owner: 'sample.action2.owner', due: 'sample.action2.due' },
  { task: 'sample.action3.task', owner: 'sample.action3.owner', due: 'sample.action3.due' },
]
const LINES: TKey[] = ['sample.t1', 'sample.t2', 'sample.t3', 'sample.t4', 'sample.t5', 'sample.t6', 'sample.t7', 'sample.t8']
const clock = (i: number) => `${String(Math.floor((i * 85) / 60)).padStart(2, '0')}:${String((i * 85) % 60).padStart(2, '0')}`

/**
 * A read-only example of what a finished meeting looks like. All content is fixed text in the current UI
 * language: nothing is recorded, stored or sent, so it works signed out and costs nothing.
 */
export default function Sample() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('summary')

  const body = (
    <div className="flex flex-col gap-4">
      <p role="note" className="rounded-2xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
        {t('sample.banner')}
      </p>
      <div>
        <h1 className="text-xl font-semibold">{t('sample.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('sample.meta')}</p>
      </div>

      <div role="tablist" className="flex gap-2">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={`min-h-11 flex-1 rounded-full px-3 py-2.5 text-sm font-bold ${
              tab === tb.id
                ? 'bg-indigo-950 text-white dark:bg-indigo-300 dark:text-indigo-950'
                : 'bg-white text-indigo-900 shadow-sm dark:bg-slate-800 dark:text-indigo-100'
            }`}
          >
            {t(tb.key)}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="card flex flex-col gap-5 p-4">
        {tab === 'summary' && (
          <>
            <section>
              <h2 className="mb-1 font-semibold">{t('summary.title')}</h2>
              <p>{t('sample.summary')}</p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">{t('summary.decisions')}</h2>
              <ul className="list-disc pl-5">
                {DECISIONS.map((k) => (
                  <li key={k}>{t(k)}</li>
                ))}
              </ul>
            </section>
          </>
        )}
        {tab === 'actions' && (
          <ul className="flex flex-col gap-2">
            {ACTIONS.map((a) => (
              <li key={a.task} className="card p-3">
                <p className="font-medium">{t(a.task)}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('actions.owner')}: {t(a.owner)} · {t('actions.due')}: {t(a.due)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {tab === 'transcript' && (
          <ol className="flex flex-col gap-2">
            {LINES.map((k, i) => (
              <li key={k} className="flex gap-3">
                <span className="w-12 shrink-0 tabular-nums text-sm text-slate-500 dark:text-slate-400">{clock(i)}</span>
                <span>{t(k)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-col gap-2 card p-4">
        <p className="font-semibold">{user ? t('sample.ctaSignedIn') : t('sample.cta')}</p>
        <Link
          to={user ? '/record' : '/login?mode=signup'}
          className="rounded-full bg-indigo-600 px-4 py-3 text-center font-semibold text-white"
        >
          {user ? t('onboarding.record') : t('landing.getStarted')}
        </Link>
      </div>
    </div>
  )

  // Signed in, the app shell already provides the header; signed out the page brings its own.
  if (user) return body
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-2xl font-bold">
          <Logo variant="mark" className="h-8 w-auto" />
          MeetNotes
        </Link>
        <LanguageSelect />
      </header>
      {body}
    </main>
  )
}
