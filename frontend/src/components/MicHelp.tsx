import { useTranslation } from 'react-i18next';
import { MicOff } from 'lucide-react';
import type { MicErrorKind } from '../lib/recorder';
import { isIOS } from '../lib/install';

export default function MicHelp({ kind, onRetry }: { kind: MicErrorKind; onRetry: () => void }) {
  const { t } = useTranslation();
  const android = /android/i.test(navigator.userAgent);
  const steps =
    kind === 'denied'
      ? isIOS()
        ? t('mic.stepsIOS')
        : android
          ? t('mic.stepsAndroid')
          : t('mic.stepsDesktop')
      : null;

  return (
    <div className="card mic-help" role="alert">
      <div className="mic-help-head">
        <MicOff size={22} aria-hidden />
        <strong>{t(`mic.${kind}.title`)}</strong>
      </div>
      <p>{t(`mic.${kind}.body`)}</p>
      {steps && <p className="muted small">{steps}</p>}
      <button type="button" className="btn" onClick={onRetry}>{t('common.tryAgain')}</button>
    </div>
  );
}
