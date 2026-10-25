import { useState } from 'react'
import Logo from '../components/Logo'
import { useAuth } from '../hooks/useAuth'
import type { ApprovalStatus } from '../hooks/useProfile'
import { useI18n } from '../i18n/context'

interface Props {
  status: Exclude<ApprovalStatus, 'approved'>
  refresh: () => Promise<void>
}

export default function PendingApproval({ status, refresh }: Props) {
  const { t } = useI18n()
  const { user, signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  const rejected = status === 'rejected'

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <Logo variant="full" className="h-12 w-auto self-start" />
      <h1 className="text-2xl font-bold">{t(rejected ? 'approval.rejectedTitle' : 'approval.pendingTitle')}</h1>
      <p className="leading-relaxed">
        {t(rejected ? 'approval.rejectedBody' : 'approval.pendingBody', { email: user?.email ?? '' })}
      </p>
      <div className="flex gap-3">
        {!rejected && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await refresh()
              setBusy(false)
            }}
            className="rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {busy ? t('approval.checking') : t('approval.check')}
          </button>
        )}
        <button onClick={signOut} className="rounded-lg border border-slate-300 px-4 py-3 dark:border-slate-700">
          {t('nav.signOut')}
        </button>
      </div>
    </main>
  )
}
