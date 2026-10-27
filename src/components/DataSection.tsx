import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/context'
import { clearLocalData, exportAllData } from '../lib/dataExport'
import { supabase } from '../lib/supabase'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Settings: download everything, or permanently delete the account. */
export default function DataSection() {
  const { t } = useI18n()
  const { user } = useAuth()
  const email = user?.email ?? ''

  const [withAudio, setWithAudio] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [exportMsg, setExportMsg] = useState<{ text: string; error: boolean } | null>(null)

  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function onExport() {
    if (!user) return
    setExporting(true)
    setExportMsg(null)
    setProgress(null)
    try {
      const r = await exportAllData(user.id, email, { includeAudio: withAudio, onProgress: (done, total) => setProgress({ done, total }) })
      download(r.blob, r.filename)
      setExportMsg({
        text: r.missingAudio ? t('data.exportedMissing', { n: r.meetings, missing: r.missingAudio }) : t('data.exported', { n: r.meetings }),
        error: false,
      })
    } catch {
      setExportMsg({ text: t('data.exportFailed'), error: true })
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  async function onDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error(t('data.deleteFailed'))
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: typed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? t('data.deleteFailed'))
      }
      await clearLocalData()
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      window.location.assign('/')
    } catch (e) {
      setDeleteError((e as Error).message || t('data.deleteFailed'))
      setDeleting(false)
    }
  }

  const matches = typed.trim().toLowerCase() === email.toLowerCase() && email !== ''
  const box = 'w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900'

  return (
    <section aria-label={t('data.title')} className="flex flex-col gap-5 card p-4">
      <h3 className="font-medium">{t('data.title')}</h3>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('data.exportHelp')}</p>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{t('data.includeAudio')}</span>
        </label>
        <button
          onClick={() => void onExport()}
          disabled={exporting}
          className="self-start rounded-full bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {exporting ? t('data.exporting') : t('data.export')}
        </button>
        {exporting && progress && (
          <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
            {t('data.audioProgress', { done: progress.done, total: progress.total })}
          </p>
        )}
        {exportMsg && (
          <p
            role={exportMsg.error ? 'alert' : 'status'}
            className={`text-sm ${exportMsg.error ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}
          >
            {exportMsg.text}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-red-300 p-4 dark:border-red-900">
        <h4 className="font-semibold text-red-700 dark:text-red-300">{t('data.deleteTitle')}</h4>
        <p className="text-sm">{t('data.deleteWhat')}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('data.deleteKept')}</p>
        <p className="text-sm font-medium">{t('data.deleteNoUndo')}</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="[overflow-wrap:anywhere]">{t('data.deleteType', { email })}</span>
          <input
            type="email"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label={t('data.deleteTypeLabel')}
            className={box}
          />
        </label>
        <button
          onClick={() => void onDelete()}
          disabled={!matches || deleting}
          className="self-start rounded-full bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {deleting ? t('data.deleting') : t('data.delete')}
        </button>
        {deleteError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {deleteError}
          </p>
        )}
      </div>
    </section>
  )
}
