import { useCallback, useEffect, useState } from 'react'
import { listRecoverable, type RecoverableDraft } from '../lib/drafts'

/**
 * Finds a recording that was being captured when the tab or browser died (see lib/drafts.ts).
 * `excludeId` is the safety copy of the recording the user is looking at right now; it is not "lost".
 */
export function useDraftRecovery(userId: string | undefined, excludeId?: string | null) {
  const [found, setFound] = useState<RecoverableDraft | null>(null)

  const refresh = useCallback(async () => {
    if (!userId) return setFound(null)
    try {
      const all = await listRecoverable(userId)
      setFound(all.find((d) => d.draft.id !== excludeId) ?? null)
    } catch {
      setFound(null) // IndexedDB unavailable: nothing to recover
    }
  }, [userId, excludeId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { found, refresh }
}
