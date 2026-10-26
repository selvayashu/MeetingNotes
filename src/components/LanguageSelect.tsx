import { useI18n } from '../i18n/context'
import { UI_LANGS, type UiLang } from '../i18n/translate'

export default function LanguageSelect() {
  const { lang, setLang } = useI18n()
  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value as UiLang)}
      aria-label="Language"
      className="rounded-2xl border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
    >
      {UI_LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.native}
        </option>
      ))}
    </select>
  )
}
