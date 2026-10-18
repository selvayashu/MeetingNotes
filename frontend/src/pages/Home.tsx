import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Mic, CloudOff } from 'lucide-react';
import { db } from '../lib/db';
import MeetingCard from '../components/MeetingCard';
import InstallBanner from '../components/InstallBanner';

export default function Home() {
  const { t } = useTranslation();
  const recent = useLiveQuery(() => db.meetings.orderBy('createdAt').reverse().limit(5).toArray(), []);
  const waiting = useLiveQuery(() => db.meetings.where('status').anyOf('queued', 'needs_notes').count(), []);

  return (
    <div className="page home">
      <section className="hero">
        <h1>{t('home.title')}</h1>
        <p className="muted">{t('home.subtitle')}</p>
        <Link to="/record" className="record-cta" aria-label={t('home.record')}>
          <span className="record-cta-dot"><Mic size={36} aria-hidden /></span>
          <span>{t('home.record')}</span>
        </Link>
      </section>

      <InstallBanner />

      {!!waiting && (
        <div className="banner warn">
          <CloudOff size={18} aria-hidden />
          <span className="banner-body">{t('home.waiting', { count: waiting })}</span>
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>{t('home.recent')}</h2>
          {!!recent?.length && <Link to="/meetings" className="link">{t('home.viewAll')}</Link>}
        </div>
        {recent === undefined ? (
          <div className="skeleton-list" aria-busy="true"><div /><div /></div>
        ) : recent.length === 0 ? (
          <p className="empty muted">{t('home.empty')}</p>
        ) : (
          <div className="list">{recent.map((m) => <MeetingCard key={m.id} meeting={m} />)}</div>
        )}
      </section>
    </div>
  );
}
