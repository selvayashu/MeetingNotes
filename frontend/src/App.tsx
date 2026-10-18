import { useEffect, useSyncExternalStore } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home as HomeIcon, ListMusic, Settings as SettingsIcon, WifiOff } from 'lucide-react';
import Home from './pages/Home';
import Library from './pages/Library';
import Recording from './pages/Recording';
import MeetingDetail from './pages/MeetingDetail';
import SettingsPage from './pages/Settings';
import Toaster from './components/Toaster';
import UpdatePrompt from './components/UpdatePrompt';
import { useSettings, type Theme } from './lib/settings';
import { startQueueProcessing } from './lib/pipeline';

function useOnline(): boolean {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener('online', l);
      window.addEventListener('offline', l);
      return () => {
        window.removeEventListener('online', l);
        window.removeEventListener('offline', l);
      };
    },
    () => navigator.onLine,
  );
}

function useTheme(theme: Theme) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111827' : '#4f46e5');
  }, [theme]);
}

export default function App() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const location = useLocation();
  const online = useOnline();
  useTheme(settings.theme);

  useEffect(() => {
    void i18n.changeLanguage(settings.uiLanguage);
    document.documentElement.lang = settings.uiLanguage;
  }, [i18n, settings.uiLanguage]);

  useEffect(() => startQueueProcessing(), []);

  const recording = location.pathname === '/record';

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>MeetNotes</span>
        </Link>
        {!online && (
          <span className="offline-pill" role="status">
            <WifiOff size={14} aria-hidden /> {t('common.offline')}
          </span>
        )}
      </header>
      <UpdatePrompt />
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/meetings" element={<Library />} />
          <Route path="/record" element={<Recording />} />
          <Route path="/meeting/:id" element={<MeetingDetail />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      {!recording && (
        <nav className="bottom-nav" aria-label={t('nav.label')}>
          <NavLink to="/" end>
            <HomeIcon size={22} aria-hidden />
            <span>{t('nav.home')}</span>
          </NavLink>
          <NavLink to="/meetings">
            <ListMusic size={22} aria-hidden />
            <span>{t('nav.meetings')}</span>
          </NavLink>
          <NavLink to="/settings">
            <SettingsIcon size={22} aria-hidden />
            <span>{t('nav.settings')}</span>
          </NavLink>
        </nav>
      )}
      <Toaster />
    </div>
  );
}
