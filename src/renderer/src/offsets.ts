/**
 * Reading the controller's coordinate systems with `$#`, and reconciling G30 — the
 * park position — between the board and the app.
 *
 * VERIFIED ON HARDWARE (26.07): G30 survives a full power cycle. `G30.1` writes it to
 * the same non-volatile storage as G54–G59, so the BOARD is the durable keeper and
 * wins whenever it holds a real value — a park spot then survives reinstalling the app
 * or moving to another PC. The app's `parkPos` (localStorage) stays as a fallback for
 * a board that has nothing stored, because the reverse can never be repaired: `G30.1`
 * only stores the CURRENT machine position, so the app cannot push its value into the
 * board. Whichever one is in play, the offsets table shows THAT number — the row has
 * to agree with where Park will actually drive.
 */
import { useStore } from './store'

export type OffsetMap = Record<string, number[]>

// [G54:0.000,0.000,0.000] · [TLO:0.000] · [PRB:0,0,0:1]
const ROW_RE = /^\[([A-Z0-9.]+):([-\d.,]+)(?::\d+)?\]$/

let inFlight: Promise<OffsetMap> | null = null
let last: { at: number; map: OffsetMap } | null = null

/**
 * Read every coordinate system with `$#`. grblHAL only answers it when Idle (else
 * error:8), so callers must gate on that. Console output is suppressed while the
 * reply streams — this is housekeeping, not something the operator typed.
 *
 * Concurrent callers share one read: two overlapping `$#` bursts would interleave
 * their replies and fight over the suppress-log flag.
 *
 * `maxAgeMs` covers the case sharing does not: two callers close together rather than
 * overlapping. On a connect the visualizer asks and, about 200 ms later, App asks
 * again when the first status shows Idle — and over Ethernet `$#` answers in 10 ms,
 * so the first read is long finished and nothing is in flight to share. Offsets do
 * not change on their own, and nothing can have moved them inside a window this
 * short, so the answer already in hand is the same answer. Only for housekeeping
 * reads: an operator pressing Read in the Offsets table asks for the board's word
 * right now, and gets it.
 */
export function readOffsets(opts?: { maxAgeMs?: number }): Promise<OffsetMap> {
  if (inFlight) return inFlight
  const maxAge = opts?.maxAgeMs ?? 0
  if (maxAge && last && Date.now() - last.at < maxAge) return Promise.resolve(last.map)
  inFlight = new Promise<OffsetMap>((resolve) => {
    const collected: OffsetMap = {}
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout>
    const finish = (): void => {
      off?.()
      clearTimeout(timer)
      useStore.getState().quietConsole(false)
      inFlight = null
      last = { at: Date.now(), map: collected }
      resolve(collected)
    }
    useStore.getState().quietConsole(true)
    off = window.recta.onEvent((e) => {
      if (e.type !== 'line') return
      const line = e.data.trim()
      const m = ROW_RE.exec(line)
      if (m) collected[m[1]] = m[2].split(',').map(Number)
      else if (line === 'ok') finish()
    })
    timer = setTimeout(finish, 3000) // safety: stop if no 'ok' ever arrives
    window.recta.send('$#')
  })
  return inFlight
}

/** True when this is a real park spot. All-zero is the blank value — and it is also
 *  machine zero, where homing already leaves the head, so parking there is a no-op. */
export function hasPark(g30: number[] | undefined | null): g30 is number[] {
  return !!g30 && g30.length >= 2 && g30.every(Number.isFinite) && g30.slice(0, 3).some((n) => n !== 0)
}

/**
 * What the G30 row should display, and whether that number came from the app rather
 * than the board. The board wins; the app's copy only fills in for a board with
 * nothing stored, and the caller badges that case so the source is never a guess.
 */
export function parkRow(
  reported: number[] | undefined,
  saved: [number, number, number] | null
): { vals: number[]; fromApp: boolean } {
  if (hasPark(reported)) return { vals: reported, fromApp: false }
  // an all-zero cache is not a park either — badging it would claim the app supplies
  // a spot when both sides are in fact blank
  if (hasPark(saved)) return { vals: saved, fromApp: true }
  return { vals: reported ?? [], fromApp: false }
}

/** Coordinate systems some grblHAL builds add beyond G54–G59 (G10 P7–P9). */
export const EXTRA_WCS = ['G59.1', 'G59.2', 'G59.3']

/**
 * Digest a `$#` reply into app state. Two things come out of it:
 *
 * 1. The park spot. Adopting the board's G30 is deliberately one-way and never
 *    destructive: a board holding a real park overwrites the cache (that is the
 *    durable truth, and it stops a stale spot from an earlier session or another
 *    machine steering the head), but a board reporting zeros leaves the cache alone
 *    rather than wiping a park the operator has set.
 * 2. Which extra coordinate systems this board has — `$#` listing G59.1–G59.3 is the
 *    only honest way to know, so the DRO offers them only once they have been seen.
 */
export function applyOffsetsRead(map: OffsetMap): void {
  const s = useStore.getState()
  const g30 = map.G30
  if (hasPark(g30)) s.setParkPos([g30[0], g30[1], g30[2] ?? 0])
  s.setExtraWcs(EXTRA_WCS.filter((k) => map[k] !== undefined))
}
