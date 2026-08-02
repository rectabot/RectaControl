/** Read the board's whole `$$` dump — once, however many people want it at once.
 *
 *  Two parts of the app ask for the settings the moment a board connects: the
 *  visualizer, which needs `$130`/`$131` to size its grid, and the Settings panel,
 *  which is showing them. Both asked separately, so a reconnect with Settings open
 *  put two `$$` on the wire in the same millisecond and brought back 232 lines where
 *  116 would do.
 *
 *  That was not merely wasteful. Every line is an event the renderer handles one at a
 *  time, and while it is doing that no timer can fire — including the poll that a
 *  settings restore uses to notice the board has come back after `$REBOOT`. Measured
 *  on 2 Aug 2026: the board was answering in 30 ms and the app took a further 8.2 s
 *  to notice, because it was busy reading the same dump twice. Filip spotted the
 *  double read from the terminal before the instrumentation found the delay.
 *
 *  So: one request in flight at a time, and everybody waiting on it gets the same
 *  answer. The lines are broadcast events, so a joiner sees them anyway — the only
 *  thing being shared is the decision not to ask twice.
 */

import { useStore } from './store'

let inflight: Promise<Map<number, string>> | null = null

export function readDump(opts?: {
  /** keep the 116 lines out of the terminal — for reads nobody asked for by hand */
  quiet?: boolean
  /** give up if the board answers nothing at all */
  capMs?: number
  /** a dump has ended when the lines stop, not on `ok` — which may be somebody else's */
  idleMs?: number
}): Promise<Map<number, string>> {
  if (inflight) return inflight
  const { quiet = false, capMs = 5000, idleMs = 700 } = opts ?? {}

  inflight = new Promise<Map<number, string>>((resolve) => {
    const out = new Map<number, string>()
    let off: (() => void) | null = null
    let idle: ReturnType<typeof setTimeout> | null = null
    let cap: ReturnType<typeof setTimeout>
    const finish = (): void => {
      if (!off) return
      off()
      off = null
      if (idle) clearTimeout(idle)
      clearTimeout(cap)
      if (quiet) useStore.getState().quietConsole(false)
      inflight = null
      resolve(out)
    }
    if (quiet) useStore.getState().quietConsole(true)
    off = window.recta.onEvent((e) => {
      if (e.type !== 'line' || !off) return
      const m = /^\$(\d+)=(.*)$/.exec(e.data.trim())
      if (!m) return
      out.set(Number(m[1]), m[2])
      if (idle) clearTimeout(idle)
      idle = setTimeout(finish, idleMs)
    })
    cap = setTimeout(finish, capMs)
    window.recta.send('$$')
  })
  return inflight
}
