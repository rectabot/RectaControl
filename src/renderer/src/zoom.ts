import { useEffect } from 'react'
import { useStore } from './store'

// Persisted manual override (a stringified factor). Absent = auto-fit to the monitor.
const ZOOM_KEY = 'ui.zoom'
const MIN = 0.5
const MAX = 2

const snap = (v: number): number => Math.min(MAX, Math.max(MIN, Math.round(v * 20) / 20))

/** Is the UI currently in auto-fit mode (no saved override)? */
export function isAutoZoom(): boolean {
  return localStorage.getItem(ZOOM_KEY) === null
}

/** Set the UI scale. A number pins a manual override (persisted); null clears it
 *  and returns to auto-fit. Main applies the actual zoom and echoes it back. */
export function setUiZoom(factor: number | null): void {
  if (factor === null) localStorage.removeItem(ZOOM_KEY)
  else localStorage.setItem(ZOOM_KEY, String(snap(factor)))
  window.recta.setZoom(factor === null ? null : snap(factor))
}

/** Nudge the current zoom by delta (e.g. ±0.1) and pin it as an override. */
export function stepZoom(delta: number): void {
  setUiZoom(snap(useStore.getState().zoomFactor + delta))
}

/** Wires UI scaling: pushes any saved override to main on mount, keeps the store's
 *  zoomFactor in sync with what main applies, and binds Ctrl +/−/0 (0 = auto-fit). */
export function useZoom(): void {
  const setZoomFactor = useStore((s) => s.setZoomFactor)

  useEffect(() => {
    // hand main the saved override (or null → let it auto-fit to the display)
    const saved = localStorage.getItem(ZOOM_KEY)
    const override = saved !== null ? Number(saved) : null
    window.recta.setZoom(override !== null && Number.isFinite(override) ? snap(override) : null)
    return window.recta.onZoom((f) => setZoomFactor(f))
  }, [setZoomFactor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '0') {
        e.preventDefault()
        setUiZoom(null)
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        stepZoom(0.1)
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        stepZoom(-0.1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
