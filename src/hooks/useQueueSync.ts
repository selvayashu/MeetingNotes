import { useCallback, useEffect, useState } from 'react'
import { listPending } from '../lib/queue'
import { flushQueue } from '../lib/upload'

/** Auto-uploads queued recordings when the app starts or the browser comes back online. */
export function useQueueSync(userId: string | undefined, onUploaded?: () => void) {
  const [pending, setPending] = useState(0)

  const sync = useCallback(async () => {
    if (!userId) return
    const n = await flushQueue(userId)
    setPending((await listPending(userId)).length)
    if (n > 0) onUploaded?.()
  }, [userId, onUploaded])

  useEffect(() => {
    if (!userId) return
    void sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [userId, sync])

  return { pending, sync }
}
