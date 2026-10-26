import { useId } from 'react'
import { useI18n } from '../i18n/context'
import { TEMPLATE_IDS, templateHelp, templateName, type TemplateId } from '../lib/templates'

interface Props {
  value: TemplateId
  onChange: (id: TemplateId) => void
  disabled?: boolean
  className?: string
}

/** Meeting-type picker with a one-line description of the selected type. */
export default function TemplateSelect({ value, onChange, disabled, className = '' }: Props) {
  const { t } = useI18n()
  const id = useId()
  const helpId = `${id}-help`
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id}>{t('template.label')}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as TemplateId)}
        aria-describedby={helpId}
        className={className}
      >
        {TEMPLATE_IDS.map((tid) => (
          <option key={tid} value={tid}>
            {t(templateName(tid))}
          </option>
        ))}
      </select>
      <span id={helpId} className="text-xs text-slate-500 dark:text-slate-400">
        {t(templateHelp(value))}
      </span>
    </div>
  )
}
