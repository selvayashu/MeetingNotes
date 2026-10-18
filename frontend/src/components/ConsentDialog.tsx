import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';

interface Props {
  onAccept: (remember: boolean) => void;
  onCancel: () => void;
}

export default function ConsentDialog({ onAccept, onCancel }: Props) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel} aria-labelledby="consent-title">
      <div className="dialog-icon"><ShieldCheck size={28} aria-hidden /></div>
      <h2 id="consent-title">{t('consent.title')}</h2>
      <p>{t('consent.body')}</p>
      <ul className="consent-points">
        <li>{t('consent.point1')}</li>
        <li>{t('consent.point2')}</li>
        <li>{t('consent.point3')}</li>
      </ul>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        {t('consent.remember')}
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="btn primary" onClick={() => onAccept(remember)}>{t('consent.accept')}</button>
      </div>
    </dialog>
  );
}
