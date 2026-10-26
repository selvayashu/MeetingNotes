import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/context'
import { watchForUpdate, type UpdateHandle } from '../lib/pwa'

/** "A new version is ready" bar, shown in the installed app and the browser alike. */
export default function UpdateBanner() {
  const { t } = useI18n()
  const [handle, setHandle] = useState<UpdateHandle | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    watchForUpdate(setHandle)
  }, [])

  if (!handle) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-xl items-center justify-between gap-3 border-t border-indigo-200 bg-indigo-50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-sm dark:border-indigo-900 dark:bg-indigo-950"
    >
      <span>{t('update.ready')}</span>
      <span className="flex shrink-0 items-center gap-3">
        <button onClick={() => setHandle(null)} className="py-2 text-slate-500 underline dark:text-slate-400">
          {t('update.later')}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void handle.apply()
          }}
          className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {t('update.now')}
        </button>
      </span>
    </div>
  )
}
