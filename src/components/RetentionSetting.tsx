import { useI18n } from '../i18n/context'

export const RETENTION_CHOICES = [null, 7, 30, 90] as const
export type Retention = (typeof RETENTION_CHOICES)[number]

interface Props {
  /** undefined while the setting is still loading. */
  value: Retention | undefined
  onChange: (v: Retention) => void
  /** "Delete audio after notes are generated" is on: it already removes audio sooner, so this has no effect. */
  overridden: boolean
}

const cls = 'rounded-2xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900'

/** Settings: how long recordings are kept. */
export default function RetentionSetting({ value, onChange, overridden }: Props) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="audio-retention" className="font-medium">
        {t('retention.label')}
      </label>
      <select
        id="audio-retention"
        value={value == null ? '' : String(value)}
        disabled={value === undefined || overridden}
        onChange={(e) => onChange(e.target.value === '' ? null : (Number(e.target.value) as Retention))}
        aria-describedby="audio-retention-help"
        className={cls}
      >
        {RETENTION_CHOICES.map((d) => (
          <option key={String(d)} value={d === null ? '' : String(d)}>
            {d === null ? t('retention.forever') : t('retention.days', { n: d })}
          </option>
        ))}
      </select>
      <span id="audio-retention-help" className="text-sm text-slate-500 dark:text-slate-400">
        {overridden ? t('retention.overridden') : t('retention.help')}
      </span>
    </div>
  )
}
