import { AuthProvider, useAuth } from './hooks/useAuth'
import { isSupabaseConfigured } from './lib/supabase'
import Login from './pages/Login'

function Shell() {
  const { user, loading, signOut } = useAuth()

  if (loading) return <p className="p-6 text-slate-500">Loading…</p>
  if (!user) return <Login />

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-3 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">MeetNotes</h1>
        <button onClick={signOut} className="text-sm text-slate-500 underline">
          Sign out
        </button>
      </header>
      <p className="text-slate-500">Signed in as {user.email}. Recording comes next.</p>
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
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </div>
  )
}
