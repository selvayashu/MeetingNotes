import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Meeting } from '../lib/db';
import { formatClock } from '../lib/db';
import { LANGUAGE_NAMES } from '../lib/languages';
import { StatusBadge } from './StatusBanner';

export default function MeetingCard({ meeting }: { meeting: Meeting }) {
  const { i18n } = useTranslation();
  const preview = meeting.notes?.summary || meeting.segments.map((s) => s.text).join(' ') || meeting.manualNotes;
  return (
    <Link to={`/meeting/${meeting.id}`} className="card meeting-card">
      <div className="meeting-card-head">
        <strong className="meeting-title">{meeting.title}</strong>
        {meeting.status !== 'ready' && meeting.status !== 'transcribed' && <StatusBadge status={meeting.status} />}
      </div>
      <div className="meeting-meta small muted">
        <span>{new Date(meeting.createdAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <span>{formatClock(meeting.durationMs / 1000)}</span>
        {meeting.detectedLanguage && <span>{LANGUAGE_NAMES[meeting.detectedLanguage] ?? meeting.detectedLanguage}</span>}
      </div>
      {preview && <p className="meeting-preview">{preview.slice(0, 180)}</p>}
      {meeting.tags.length > 0 && (
        <div className="tags">
          {meeting.tags.map((tag) => (
            <span key={tag} className="chip">#{tag}</span>
          ))}
        </div>
      )}
    </Link>
  );
}
