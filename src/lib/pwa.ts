import { registerSW } from 'virtual:pwa-register'

export interface UpdateHandle {
  /** Activate the waiting version and reload. */
  apply: () => Promise<void>
}

const HOUR = 60 * 60 * 1000

/**
 * Registers the service worker and calls `onReady` when a newer version has been downloaded. Nothing reloads by
 * itself (a recording may be in progress); the person chooses when via `apply`. An installed app is rarely
 * reloaded, so we also look for a new version when it is opened again and once an hour.
 */
export function watchForUpdate(onReady: (h: UpdateHandle) => void) {
  const update = registerSW({
    onNeedRefresh: () => onReady({ apply: () => update(true) }),
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => {})
      }
      setInterval(check, HOUR)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })
}
