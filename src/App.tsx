import { useEffect, useState } from 'react'

export default function App() {
  const [health, setHealth] = useState<string>('checking…')

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((j) => setHealth(j.ok ? 'API ok' : 'API error'))
      .catch(() => setHealth('API unreachable'))
  }, [])

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3 bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <h1 className="text-3xl font-bold">MeetNotes</h1>
      <p className="text-slate-500">Hello, world — PWA scaffold is running.</p>
      <p className="text-sm">{health}</p>
    </main>
  )
}
