import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new version every hour while the app stays open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  if (!offlineReady && !needRefresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>{needRefresh ? t('update.available') : t('update.offlineReady')}</span>
      {needRefresh && (
        <button type="button" className="btn small primary" onClick={() => void updateServiceWorker(true)}>
          {t('update.reload')}
        </button>
      )}
      <button
        type="button"
        className="btn small ghost"
        onClick={() => {
          setOfflineReady(false);
          setNeedRefresh(false);
        }}
      >
        {t('common.dismiss')}
      </button>
    </div>
  );
}
