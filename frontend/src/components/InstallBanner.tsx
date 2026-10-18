import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Share, X } from 'lucide-react';
import { isIOS, isStandalone, useInstallPrompt } from '../lib/install';

const DISMISS_KEY = 'meetnotes.installDismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export default function InstallBanner() {
  const { t } = useTranslation();
  const { canInstall, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (dismissed || isStandalone()) return null;
  const ios = isIOS();
  if (!canInstall && !ios) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="card install-banner">
      <div className="install-text">
        <strong>{t('install.title')}</strong>
        <span className="muted small">
          {ios ? (
            <>
              {t('install.iosPrefix')} <Share size={14} aria-label="Share" className="inline-icon" /> {t('install.iosSuffix')}
            </>
          ) : (
            t('install.body')
          )}
        </span>
      </div>
      {canInstall && (
        <button type="button" className="btn primary" onClick={() => void install()}>
          <Download size={16} aria-hidden /> {t('install.button')}
        </button>
      )}
      <button type="button" className="icon-btn" onClick={dismiss} aria-label={t('common.dismiss')}>
        <X size={18} />
      </button>
    </div>
  );
}
