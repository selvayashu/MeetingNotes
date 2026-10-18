import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, X } from 'lucide-react';
import { db, transcriptText } from '../lib/db';
import MeetingCard from '../components/MeetingCard';

export default function Library() {
  const { t } = useTranslation();
  const meetings = useLiveQuery(() => db.meetings.orderBy('createdAt').reverse().toArray(), []);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const allTags = useMemo(() => [...new Set((meetings ?? []).flatMap((m) => m.tags))].sort(), [meetings]);

  const filtered = useMemo(() => {
    if (!meetings) return [];
    const q = query.trim().toLowerCase();
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
    return meetings.filter((m) => {
      if (tag && !m.tags.includes(tag)) return false;
      if (m.createdAt < fromMs || m.createdAt > toMs) return false;
      if (!q) return true;
      const n = m.notes;
      const haystack = [
        m.title,
        m.tags.join(' '),
        m.manualNotes,
        transcriptText(m),
        n?.summary,
        n?.key_points.join(' '),
        n?.decisions.join(' '),
        n?.action_items.map((a) => `${a.task} ${a.owner}`).join(' '),
        n?.open_questions.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [meetings, query, tag, from, to]);

  const hasFilters = query || tag || from || to;

  return (
    <div className="page">
      <h1>{t('library.title')}</h1>
      <div className="filters">
        <label className="search">
          <Search size={18} aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('library.search')} aria-label={t('library.search')} />
        </label>
        <div className="date-range">
          <label>
            <span className="small muted">{t('library.from')}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span className="small muted">{t('library.to')}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        {allTags.length > 0 && (
          <div className="tags" role="group" aria-label={t('meeting.tags')}>
            {allTags.map((x) => (
              <button type="button" key={x} className={`chip ${tag === x ? 'active' : ''}`} onClick={() => setTag(tag === x ? null : x)} aria-pressed={tag === x}>
                #{x}
              </button>
            ))}
          </div>
        )}
        {hasFilters && (
          <button type="button" className="btn small ghost" onClick={() => { setQuery(''); setTag(null); setFrom(''); setTo(''); }}>
            <X size={14} aria-hidden /> {t('library.clear')}
          </button>
        )}
      </div>

      {meetings === undefined ? (
        <div className="skeleton-list" aria-busy="true"><div /><div /><div /></div>
      ) : filtered.length === 0 ? (
        <p className="empty muted">{meetings.length ? t('library.noResults') : t('home.empty')}</p>
      ) : (
        <div className="list">{filtered.map((m) => <MeetingCard key={m.id} meeting={m} />)}</div>
      )}
    </div>
  );
}
