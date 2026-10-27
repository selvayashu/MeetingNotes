import { useState } from 'react'
import { useI18n } from '../i18n/context'
import { collectDiagnostics, formatDiagnostics, testRecording, type DiagRow, type MicTestResult } from '../lib/diagnostics'

/** Settings: what this device supports, a three-second recording test, and a copy button for bug reports. */
export default function Diagnostics() {
  const { t } = useI18n()
  const [rows, setRows] = useState<DiagRow[] | null>(null)
  const [mic, setMic] = useState<MicTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)

  async function open(isOpen: boolean) {
    if (isOpen && !rows) setRows(await collectDiagnostics())
  }

  async function runTest() {
    setTesting(true)
    setMic(null)
    try {
      setMic(await testRecording())
    } finally {
      setTesting(false)
    }
  }

  async function copy() {
    const text = formatDiagnostics(rows ?? [], mic ? [{ label: 'Recording test', value: `${mic.ok ? 'passed' : 'FAILED'}: ${mic.summary}` }, ...mic.rows] : [])
    try {
      await navigator.clipboard.writeText(text)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
  }

  return (
    <details onToggle={(e) => void open((e.target as HTMLDetailsElement).open)} className="card p-4">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('diag.title')}</summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('diag.help')}</p>

        <div className="flex flex-col gap-2">
          <button onClick={() => void runTest()} disabled={testing} className="self-start rounded-full bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
            {testing ? t('diag.testing') : t('diag.test')}
          </button>
          {mic && (
            <div role="status" className="text-sm">
              <p className={`font-semibold ${mic.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-300'}`}>
                {mic.ok ? '✓' : '⚠'} {mic.summary}
              </p>
              <ul className="mt-1 text-slate-600 dark:text-slate-300">
                {mic.rows.map((r) => (
                  <li key={r.label}>
                    {r.label}: {r.value}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {rows ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="font-medium">{r.label}</dt>
                <dd className="break-words text-slate-600 dark:text-slate-300">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        )}

        <button onClick={() => void copy()} disabled={!rows} className="self-start rounded-2xl border border-slate-200 bg-white px-4 py-2 font-semibold dark:border-slate-700 dark:bg-slate-900">
          {t('diag.copy')}
        </button>
        {copied && (
          <p role="status" className="text-sm">
            {copied === 'ok' ? t('diag.copied') : t('diag.copyFailed')}
          </p>
        )}
      </div>
    </details>
  )
}
