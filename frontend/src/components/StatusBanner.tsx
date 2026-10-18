import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CloudOff, Loader2, RotateCw } from 'lucide-react';
import type { Meeting } from '../lib/db';
import { useProgress } from '../lib/progress';
import { retryMeeting } from '../lib/pipeline';
import { toast } from '../lib/toast';

export function StatusBadge({ status }: { status: Meeting['status'] }) {
  const { t } = useTranslation();
  return <span className={`badge status-${status}`}>{t(`status.${status}`)}</span>;
}

/** Loading / queued / failed state of a meeting, with progress and retry. */
export default function StatusBanner({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const progress = useProgress(meeting.id);
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await retryMeeting(meeting.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const retryButton = (
    <button type="button" className="btn small" onClick={() => void retry()} disabled={busy}>
      <RotateCw size={14} aria-hidden className={busy ? 'spin' : ''} /> {t('common.retry')}
    </button>
  );

  switch (meeting.status) {
    case 'transcribing':
    case 'summarizing':
      return (
        <div className="banner info" role="status">
          <Loader2 size={18} className="spin" aria-hidden />
          <div className="banner-body">
            <span>{t(meeting.status === 'transcribing' ? 'banner.transcribing' : 'banner.summarizing')}</span>
            {progress !== undefined && (
              <div className="progress" aria-label={`${Math.round(progress * 100)}%`}>
                <div style={{ width: `${Math.max(3, progress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      );
    case 'queued':
    case 'needs_notes':
      return (
        <div className="banner warn" role="status">
          <CloudOff size={18} aria-hidden />
          <div className="banner-body">
            <span>{t(meeting.status === 'queued' ? 'banner.queued' : 'banner.notesQueued')}</span>
            {meeting.error && <span className="small muted">{meeting.error}</span>}
          </div>
          {retryButton}
        </div>
      );
    case 'failed':
      return (
        <div className="banner error" role="alert">
          <AlertTriangle size={18} aria-hidden />
          <div className="banner-body">
            <span>{t(meeting.failedStep === 'notes' ? 'banner.notesFailed' : 'banner.transcriptionFailed')}</span>
            {meeting.error && <span className="small">{meeting.error}</span>}
          </div>
          {retryButton}
        </div>
      );
    default:
      return meeting.warning ? (
        <div className="banner warn" role="status">
          <AlertTriangle size={18} aria-hidden />
          <span className="banner-body small">{meeting.warning}</span>
        </div>
      ) : null;
  }
}
