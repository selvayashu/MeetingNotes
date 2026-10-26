import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ConsentNotice from '../components/ConsentNotice'
import LiveCaptions from '../components/LiveCaptions'
import TemplateSelect from '../components/TemplateSelect'
import { useLiveCaptions } from '../hooks/useLiveCaptions'
import { readCaptionsPref, recognitionLang, saveCaptionsPref } from '../lib/liveCaptions'
import { readTemplate, saveTemplate, type TemplateId } from '../lib/templates'
import { useAuth } from '../hooks/useAuth'
import { useDraftRecovery } from '../hooks/useDraftRecovery'
import { useRecorder } from '../hooks/useRecorder'
import { useI18n } from '../i18n/context'
import {
  ACCEPTED_AUDIO,
  MAX_RECORDING_SECONDS,
  formatClock,
  partsFromFile,
  type UploadPart,
} from '../lib/audio'
import { deleteDraft, loadDraftParts } from '../lib/drafts'
import { readSpokenLanguage, saveSpokenLanguage } from '../lib/spokenLanguage'
import type { Lang } from '../lib/types'
import { submitRecording } from '../lib/upload'

const fieldCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-900'

export default function Record() {
  const { user } = useAuth()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const rec = useRecorder(user?.id)
  const { found: lost, refresh: refreshLost } = useDraftRecovery(user?.id, rec.getDraftId())
  const fileInput = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState<Lang>(() => readSpokenLanguage(lang))
  const [notesLanguage, setNotesLanguage] = useState<Lang>('en')
  const [template, setTemplate] = useState<TemplateId>(() => readTemplate())
  const [captionsOn, setCaptionsOn] = useState(() => readCaptionsPref())
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Asked afresh for every recording: it is a statement about *this* meeting's participants.
  const [consent, setConsent] = useState(false)
  const [showNotice, setShowNotice] = useState(false)
  // A recording recovered after a crash; it is saved through the normal path below.
  const [recovered, setRecovered] = useState<{ draftId: string; parts: UploadPart[] } | null>(null)

  // Multi-segment recordings can't be previewed as one file, so only preview a single segment.
  const previewUrl = useMemo(
    () => (rec.result?.parts.length === 1 ? URL.createObjectURL(rec.result.parts[0].blob) : null),
    [rec.result],
  )
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const active = rec.state === 'recording' || rec.state === 'paused'
  const captions = useLiveCaptions({
    enabled: captionsOn,
    active: rec.state === 'recording',
    lang: recognitionLang(language, lang),
    resetKey: rec.state === 'idle',
  })
  const hasAudio = Boolean(rec.result || file || recovered)
  const recoveredSeconds = recovered?.parts.reduce((s, p) => s + (p.durationSeconds ?? 0), 0) ?? 0

  async function save() {
    if (!user) return
    if (!rec.result && !file && !recovered) return
    if (!consent) return setError(t('consent.required'))
    setBusy(true)
    setError(null)
    try {
      const parts: UploadPart[] = recovered?.parts ?? rec.result?.parts ?? (await partsFromFile(file!))
      const duration = parts.every((p) => p.durationSeconds != null)
        ? parts.reduce((s, p) => s + (p.durationSeconds ?? 0), 0)
        : null
      if (duration && duration > MAX_RECORDING_SECONDS) {
        throw new Error(t('record.tooLong', { min: MAX_RECORDING_SECONDS / 60 }))
      }
      const res = await submitRecording({
        userId: user.id,
        parts,
        title: title.trim() || file?.name.replace(/\.[^.]+$/, '') || t('record.untitled'),
        language,
        notesLanguage,
        template,
        consent: true,
      })
      setConsent(false)
      // The recording is now in the upload queue, so the safety copy is no longer needed.
      await rec.discardDraft()
      if (recovered) await deleteDraft(recovered.draftId)
      if (res.queued) {
        setNotice(t('record.offlineSaved'))
        rec.reset()
        setFile(null)
        setRecovered(null)
      } else {
        navigate(`/?process=${res.id}`)
      }
    } catch (e) {
      setError((e as Error).message || t('record.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold">{t('record.title')}</h2>

      {lost && !active && !hasAudio && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
        >
          <p>
            {t('draft.found', {
              when: new Date(lost.draft.startedAt).toLocaleString(lang),
              min: Math.max(1, Math.round(lost.chunkCount / 60)),
            })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                setRecovered({ draftId: lost.draft.id, parts: await loadDraftParts(lost.draft.id) })
                void refreshLost()
              }}
              className="rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white"
            >
              {t('draft.recover')}
            </button>
            <button
              onClick={async () => {
                await deleteDraft(lost.draft.id)
                void refreshLost()
              }}
              className="rounded-lg border border-amber-400 px-3 py-2 dark:border-amber-600"
            >
              {t('common.discard')}
            </button>
          </div>
        </div>
      )}

      <input
        className={fieldCls}
        placeholder={t('record.titlePlaceholder')}
        aria-label={t('record.titlePlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          {t('record.spoken')}
          <select
            className={fieldCls}
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value as Lang)
              saveSpokenLanguage(e.target.value as Lang)
            }}
          >
            <option value="auto">{t('lang.auto')}</option>
            <option value="en">{t('lang.en')}</option>
            <option value="hi">{t('lang.hi')}</option>
            <option value="ta">{t('lang.ta')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t('record.notesLang')}
          <select
            className={fieldCls}
            value={notesLanguage}
            onChange={(e) => setNotesLanguage(e.target.value as Lang)}
          >
            <option value="en">{t('lang.en')}</option>
            <option value="auto">{t('lang.same')}</option>
          </select>
        </label>
      </div>

      <TemplateSelect
        value={template}
        onChange={(id) => {
          setTemplate(id)
          saveTemplate(id)
        }}
        className={fieldCls}
      />

      <LiveCaptions
        supported={captions.supported}
        enabled={captionsOn}
        onToggle={(on) => {
          setCaptionsOn(on)
          saveCaptionsPref(on)
        }}
        recording={active}
        lines={captions.lines}
        interim={captions.interim}
        problem={captions.problem}
      />

      {language === 'auto' && <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">{t('record.langHint')}</p>}
      {language === 'ta' && <p className="-mt-2 text-xs text-amber-700 dark:text-amber-400">{t('record.tamilNote')}</p>}

      <section
        aria-labelledby="consent-heading"
        className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20"
      >
        <h3 id="consent-heading" className="text-sm font-semibold">
          {t('consent.title')}
        </h3>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={consent}
            disabled={active}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>{t('consent.label')}</span>
        </label>
        <p className="text-xs text-slate-600 dark:text-slate-300">{t('consent.help')}</p>
        <button type="button" onClick={() => setShowNotice(true)} className="self-start py-1 text-sm font-semibold text-indigo-700 underline dark:text-indigo-300">
          {t('consent.showNotice')}
        </button>
      </section>

      <section className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 p-6 dark:border-slate-800">
        {active && (
          <p role="status" className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
            <span aria-hidden className="animate-pulse">●</span>
            {t('consent.banner')}
          </p>
        )}
        <div className="font-mono text-4xl tabular-nums" aria-live="off">
          {formatClock(recovered ? recoveredSeconds : rec.state === 'stopped' ? (rec.result?.durationSeconds ?? 0) : rec.elapsed)}
        </div>

        <div
          className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          role="meter"
          aria-label={t('record.meter')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(rec.level * 100)}
        >
          <div className="h-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${rec.level * 100}%` }} />
        </div>

        {!active && !hasAudio && (
          <>
            <button
              onClick={rec.start}
              disabled={!consent}
              aria-label={t('record.start')}
              className="h-28 w-28 rounded-full bg-red-600 text-lg font-semibold text-white shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
            >
              {t('record.rec')}
            </button>
            {!consent && <p className="text-xs text-slate-500 dark:text-slate-400">{t('consent.required')}</p>}
          </>
        )}

        {active && (
          <div className="flex items-center gap-4">
            <button
              onClick={rec.state === 'paused' ? rec.resume : rec.pause}
              className="h-16 rounded-full border border-slate-300 px-6 font-semibold dark:border-slate-700"
            >
              {rec.state === 'paused' ? t('record.resume') : t('record.pause')}
            </button>
            <button onClick={rec.stop} className="h-20 w-20 rounded-full bg-red-600 font-semibold text-white">
              {t('record.stop')}
            </button>
          </div>
        )}

        {previewUrl && <audio controls className="w-full" src={previewUrl} />}
        {rec.result && rec.result.parts.length > 1 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('record.segments', { n: rec.result.parts.length })}</p>
        )}

        {recovered && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {t('draft.recovered', { min: Math.max(1, Math.round(recoveredSeconds / 60)) })}
          </p>
        )}

        {!active && !rec.result && !recovered && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_AUDIO}
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button onClick={() => fileInput.current?.click()} className="text-sm text-indigo-600 underline dark:text-indigo-400">
              {file ? t('record.selected', { name: file.name }) : t('record.uploadLink')}
            </button>
          </>
        )}
      </section>

      {hasAudio && !active && (
        <div className="flex gap-3">
          <button
            onClick={() => {
              rec.reset()
              setFile(null)
              setConsent(false)
              void rec.discardDraft()
              if (recovered) void deleteDraft(recovered.draftId)
              setRecovered(null)
            }}
            className="rounded-lg border border-slate-300 px-4 py-3 dark:border-slate-700"
          >
            {t('common.discard')}
          </button>
          <button
            onClick={save}
            disabled={busy || !consent}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {busy ? t('record.saving') : t('record.save')}
          </button>
        </div>
      )}

      {(error || rec.error) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error ?? t(`record.err.${rec.error!}`)}
        </p>
      )}
      {notice && <p className="text-sm text-amber-700 dark:text-amber-400">{notice}</p>}
      {showNotice && (
        <ConsentNotice
          initialLang={language === 'auto' ? lang : language}
          onClose={() => setShowNotice(false)}
        />
      )}
    </div>
  )
}
