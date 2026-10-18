import { dismissToast, useToasts } from '../lib/toast';

export default function Toaster() {
  const toasts = useToasts();
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <button type="button" key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}
