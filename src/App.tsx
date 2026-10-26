import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Logo from './components/Logo'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { useProfile } from './hooks/useProfile'
import { useI18n } from './i18n/context'
import { isUiLang } from './i18n/translate'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import Admin from './pages/Admin'
import AdminUsage from './pages/AdminUsage'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import MeetingDetail from './pages/MeetingDetail'
import PendingApproval from './pages/PendingApproval'
import ResetPassword from './pages/ResetPassword'
import Record from './pages/Record'
import Settings from './pages/Settings'
import { applyTheme, readTheme } from './theme'

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/** On a new device (no local choice yet), adopt a non-English language saved on the profile. */
function useAdoptProfileLanguage(userId: string | undefined) {
  const { setLang } = useI18n()
  useEffect(() => {
    if (!userId) return
    try {
      if (localStorage.getItem('meetnotes.lang')) return
    } catch {
      return
    }
    void supabase
      .from('profiles')
      .select('preferred_language')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        const l = data?.preferred_language
        if (isUiLang(l) && l !== 'en') setLang(l)
      })
  }, [userId, setLang])
}

function Shell() {
  const { user, loading, recovery } = useAuth()
  const { t } = useI18n()
  const online = useOnline()
  const { profile, loading: profileLoading, error: profileError, refresh } = useProfile(user?.id)
  useAdoptProfileLanguage(user?.id)

  if (loading || (user && profileLoading)) return <p className="p-6 text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
  if (!user) return <Login />
  // Opened from a "reset password" e-mail: choosing a new password comes before anything else.
  if (recovery) return <ResetPassword />
  if (profileError) return <p role="alert" className="p-6 text-red-600 dark:text-red-400">{profileError}</p>
  // Not approved yet (or rejected): nothing else in the app is reachable.
  if (profile?.status !== 'approved') {
    return <PendingApproval status={profile?.status === 'rejected' ? 'rejected' : 'pending'} refresh={refresh} />
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-4 pb-24 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-2xl font-bold">
          <Logo variant="mark" className="h-8 w-auto" />
          MeetNotes
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-500 underline dark:text-slate-400">
          {profile.is_admin && <Link to="/admin">{t('nav.admin')}</Link>}
          <Link to="/settings">{t('nav.settings')}</Link>
        </nav>
      </header>
      {!online && (
        <p role="status" className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          {t('common.offline')}
        </p>
      )}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/record" element={<Record />} />
        <Route path="/meeting/:id" element={<MeetingDetail />} />
        <Route path="/settings" element={<Settings />} />
        {profile.is_admin && <Route path="/admin" element={<Admin />} />}
        {profile.is_admin && <Route path="/admin/usage" element={<AdminUsage />} />}
      </Routes>
    </main>
  )
}

export default function App() {
  const { t } = useI18n()
  useEffect(() => applyTheme(readTheme()), [])

  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-2 text-xl font-bold">{t('config.title')}</h1>
        <p>{t('config.body')}</p>
      </main>
    )
  }
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
