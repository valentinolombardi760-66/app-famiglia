import { useEffect, useRef } from 'react'

/**
 * Calls `onResume` when the app comes back to the foreground, so a phone that
 * kept the app open since the morning shows what others changed meanwhile.
 */
export function useResume(onResume: () => void) {
  const latest = useRef(onResume)
  latest.current = onResume
  useEffect(() => {
    let hiddenAt = 0
    const onChange = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      // Ignore quick switches (e.g. a glance at a notification).
      else if (hiddenAt && Date.now() - hiddenAt > 30_000) latest.current()
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
}
