import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { isSupabaseConfigured } from './lib/supabase'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Record from './pages/Record'

function Shell() {
  const { user, loading, signOut } = useAuth()

  if (loading) return <p className="p-6 text-slate-500">Loading…</p>
  if (!user) return <Login />

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <Link to="/" className="text-2xl font-bold">
          MeetNotes
        </Link>
        <button onClick={signOut} className="text-sm text-slate-500 underline">
          Sign out
        </button>
      </header>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/record" element={<Record />} />
      </Routes>
    </main>
  )
}

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-2 text-xl font-bold">Supabase not configured</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code> and set{' '}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
        </p>
      </main>
    )
  }
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <BrowserRouter>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </BrowserRouter>
    </div>
  )
}
