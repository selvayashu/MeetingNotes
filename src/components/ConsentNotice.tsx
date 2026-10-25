import { useEffect, useRef, useState } from 'react'
import { UI_LANGS, translate, type UiLang } from '../i18n/translate'

interface Props {
  /** Language to start in; the viewer can switch, because the people in the room may not read the app's language. */
  initialLang: UiLang
  onClose: () => void
}

/**
 * Full-screen "this meeting is being recorded" notice, meant to be shown to the people in the room (or screen-shared).
 * It deliberately ignores the app's own language setting: it is for the participants, not for the person recording.
 */
export default function ConsentNotice({ initialLang, onClose }: Props) {
  const [lng, setLng] = useState<UiLang>(initialLang)
  const [copied, setCopied] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const say = (key: Parameters<typeof translate>[1]) => translate(lng, key)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${say('consent.noticeTitle')}\n${say('consent.notice')}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable: the text is on screen anyway */
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-notice-title"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-y-auto bg-slate-950 p-6 text-center text-white"
    >
      <div role="group" aria-label={say('consent.language')} className="flex gap-2">
        {UI_LANGS.map((l) => (
          <button
            key={l.code}
            onClick={() => setLng(l.code)}
            aria-pressed={lng === l.code}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${
              lng === l.code ? 'border-white bg-white text-slate-950' : 'border-slate-600 text-slate-200'
            }`}
          >
            {l.native}
          </button>
        ))}
      </div>

      <span aria-hidden className="animate-pulse text-6xl text-red-500">●</span>
      <h2 id="consent-notice-title" lang={lng} className="text-3xl font-bold sm:text-4xl">
        {say('consent.noticeTitle')}
      </h2>
      <p lang={lng} className="max-w-2xl text-xl leading-relaxed text-slate-100 sm:text-2xl">
        {say('consent.notice')}
      </p>

      <div className="flex gap-3">
        <button onClick={copy} className="rounded-lg border border-slate-500 px-4 py-3 font-semibold">
          {copied ? say('consent.copied') : say('consent.copy')}
        </button>
        <button ref={closeRef} onClick={onClose} className="rounded-lg bg-white px-5 py-3 font-semibold text-slate-950">
          {say('consent.close')}
        </button>
      </div>
    </div>
  )
}
