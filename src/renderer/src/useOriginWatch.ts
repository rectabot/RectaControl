/**
 * Notice when the work origin moves, and go and find out where it landed.
 *
 * The board never volunteers this. `G10 L20` changes G54 and answers a bare `ok`; no
 * line comes back saying what the new offset is. The app's copy of the offsets is
 * filled from `[G54:…]` rows alone, and those arrive only in reply to `$#` — so
 * whoever moves the zero must ask, or the drawing keeps the old one.
 *
 * The probe cycle learned that on 2 Aug 2026 and asks for itself. Nothing else did,
 * and every other way of setting a zero had the same hole: the DRO's X0/Y0/Z0 buttons,
 * the keyboard and gamepad zero actions, the offsets table, and an operator typing
 * `G10 L20 P0 Z0` into the console by hand. Filip hit it on 3 Aug 2026 the plainest
 * way there is — jog Z down 20 mm, press Z0 in the DRO, run the program. The toolpath
 * went on being drawn 20 mm above where the machine was cutting, so the tool marker
 * never sat on the cut, no line greyed out behind it, and the G-code editor held on
 * the line it started at. The tracker said so in the log, in millimetres, every ten
 * seconds: `tool is 20.0 mm off the drawn path` — exactly the jog.
 *
 * So watch the one place all of it passes through instead of patching each caller.
 * `sendLine` in the main process emits a `sent` event for every command line the app
 * puts on the wire, and streamed program lines deliberately do NOT pass through it —
 * which makes it precisely the set of commands worth watching, and covers the console
 * for free.
 */
import { useEffect, useState } from 'react'
import { useStore } from './store'
import { readOffsets, applyOffsetsRead } from './offsets'
import { movesOrigin } from '@shared/grbl'

/** How long to wait before asking, so that one press means one read. Zeroing all
 *  axes from the DRO sends three separate lines (X, Y, then Z) and each one restarts
 *  this — the read happens once, after the last of them. */
const SETTLE_MS = 250

export function useOriginWatch(): void {
  const running = useStore((s) => s.job.running)
  const sdRunning = useStore((s) => s.sdRunning)
  const state = useStore((s) => (s.status?.state ?? '').split(':')[0])
  // A counter rather than a ref: the read has to be able to start on a machine that
  // is ALREADY idle and stays that way, which is the ordinary case — press Z0, nothing
  // else changes. A ref would set no render going and the effect below would never run.
  const [moved, setMoved] = useState(0)

  useEffect(
    () =>
      window.recta.onEvent((e) => {
        if (e.type === 'sent' && movesOrigin(e.data)) setMoved((n) => n + 1)
      }),
    []
  )

  useEffect(() => {
    // `$#` is answered only when Idle (else error:8), and sending one mid-program is
    // the thing that broke the character counting on 31 Jul. Both say the same: wait.
    // The flag keeps until then, so a zero set from the console while the machine is
    // still jogging is read back the moment it settles rather than lost.
    if (!moved || running || sdRunning || state !== 'Idle') return
    const timer = setTimeout(() => {
      setMoved(0)
      // No age allowance: staleness is the entire complaint. Concurrent callers still
      // share one read, which is what keeps this from doubling up with the probe's own.
      void readOffsets().then(applyOffsetsRead)
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [moved, running, sdRunning, state])
}
