/** Write a saved `$$` dump back to the board, line by line, and say what stuck.
 *
 *  Shared by the Settings import button and the guided recovery, which finishes by
 *  putting the machine's own numbers back on a board that has just been reset to
 *  factory. There must be exactly one of these: a restore that quietly drops a line
 *  is worse than one that refuses out loud, and it is not a thing to get right twice.
 */

import { useStore } from './store'

/** Send one `$n=v` and wait for the board's verdict. Resolves null on `ok`, else
 *  the refusal (or 'no answer' when nothing comes back in time). */
function sendSetting(line: string): Promise<string | null> {
  return new Promise((resolve) => {
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (r: string | null): void => {
      off?.()
      off = null
      if (timer) clearTimeout(timer)
      resolve(r)
    }
    off = window.recta.onEvent((ev) => {
      if (ev.type !== 'line' || !off) return
      const s = ev.data.trim()
      if (/^ok$/i.test(s)) finish(null)
      else if (/^error:\d+/i.test(s)) finish(s)
    })
    timer = setTimeout(() => finish('no answer'), 1500)
    window.recta.send(line)
  })
}

/** Read the board's settings back as a map. The only trustworthy way to know what
 *  landed: matching replies to commands means taking the next `ok`, and anything
 *  else writing to the board mid-restore shifts every verdict after it by one. */
function readBack(timeoutMs = 4000): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    const out = new Map<string, string>()
    let off: (() => void) | null = null
    let quiet: ReturnType<typeof setTimeout> | null = null
    const finish = (): void => {
      off?.()
      off = null
      if (quiet) clearTimeout(quiet)
      resolve(out)
    }
    off = window.recta.onEvent((ev) => {
      if (ev.type !== 'line' || !off) return
      const m = /^\$(\d+)=(.*)$/.exec(ev.data.trim())
      if (!m) return
      out.set(m[1], m[2].trim())
      // the dump ends when the lines stop coming, not on `ok` — which may itself
      // belong to something else
      if (quiet) clearTimeout(quiet)
      quiet = setTimeout(finish, 700)
    })
    setTimeout(finish, timeoutMs)
    window.recta.send('$$')
  })
}

export interface ApplyResult {
  /** how many `$n=v` lines the file held */
  total: number
  /** `$n=v` for every setting that is NOT on the board afterwards, with what the
   *  board says instead — read back, not inferred from the replies. */
  refused: string[]
}

/** grblHAL prints numbers back in its own format (`$100=640.000` for a written
 *  `640`), so compare as numbers where both sides are numeric. */
function same(a: string, b: string): boolean {
  if (a === b) return true
  const na = Number(a)
  const nb = Number(b)
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb
}

/** Apply every `$n=v` line in `text`.
 *
 *  Two passes, because a dump is written in numeric order while some settings depend
 *  on one that sorts *after* them: `$20` (soft limits) is refused with error:10 until
 *  `$22` (homing) is on, so the first pass legitimately fails on those and a single
 *  retry fixes them. This is not hypothetical — on 29 Jul 2026 a restore silently
 *  left soft limits off on a machine whose file said they were on, and nobody knew
 *  until the file and the board were diffed by hand. Whatever is still refused after
 *  the retry is a real mismatch and is reported.
 */
export async function applySettings(
  text: string,
  onProgress?: (done: number, total: number) => void,
  opts?: {
    /** Restart the board once, and retry whatever is still missing.
     *
     *  Some settings only exist while the thing they belong to is live, and that is
     *  decided at boot. `$476` (VFD ModBus address) exists only while a VFD is the
     *  default spindle, which comes from `$395` — read when the board starts. So on
     *  a board that just came up on factory defaults, writing `$395=1` switches the
     *  spindle at once but `$476` stays unavailable (error:53, "setting disabled")
     *  for the rest of that session, and the restore ends one setting short with no
     *  way to finish. The same is true of `$301` and the other boot-read settings.
     *
     *  Confirmed on hardware 30 Jul 2026: refused before a restart, `ok` after. */
    rebootToFinish?: boolean
    onReboot?: () => void
  }
): Promise<ApplyResult> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\$\d+=/.test(l))

  // Take the wire. The limits machinery writes `$21` off its own status handler,
  // and one injected command is enough to shift every reply-to-command match after
  // it by one — see `bulkWriting` in the store.
  useStore.getState().setBulkWriting(true)
  try {
    // Let whatever is already in flight finish. A restore starts the moment the
    // board answers again, which after a reboot is in the middle of the app's own
    // $#, $$, $G, $I, $SPINDLESH burst — every one of them trailing an `ok` with
    // nobody's name on it.
    await quiet()

    // Write, check, rewrite what did not take, check again. Acks are used for
    // PACING ONLY and their verdict is discarded: one stray `ok` from something
    // else shifts every reply-to-command match after it by one, which is how a
    // refused `$20` got credited to its neighbour and never made the retry list —
    // the machine kept its soft limits off and the restore said it was fine
    // (30 Jul 2026). What the board holds afterwards is the only honest answer, so
    // that is what decides both the retry and the report.
    let done = 0
    for (const line of lines) {
      await sendSetting(line)
      onProgress?.(++done, lines.length)
    }

    // A second pass fixes the ordering the file cannot express: a dump is written
    // in numeric order while `$20` (soft limits) is refused until `$22` (homing) is
    // on, several lines later.
    let missed = await diff(lines)
    if (missed.length) {
      await quiet()
      for (const { line } of missed) await sendSetting(line)
      missed = await diff(lines)
    }

    // Anything left may simply not exist yet on a board that has not restarted with
    // these settings in it — see rebootToFinish above. One restart, one more pass.
    if (missed.length && opts?.rebootToFinish) {
      opts.onReboot?.()
      window.recta.send('$REBOOT')
      if (await waitForBoard()) {
        await quiet()
        for (const { line } of missed) await sendSetting(line)
        missed = await diff(lines)
      }
    }

    return {
      total: lines.length,
      refused: missed.map((m) => (m.now === null ? `${m.line} → not on this board` : `${m.line} → board says ${m.now}`))
    }
  } finally {
    useStore.getState().setBulkWriting(false)
  }
}

/** Wait for the board to come back and answer a line command. The app reconnects on
 *  its own after a reboot; this only has to wait for it and then check that the
 *  parser — not merely the link — is up. */
async function waitForBoard(totalMs = 25000): Promise<boolean> {
  const until = Date.now() + totalMs
  await new Promise((r) => setTimeout(r, 2500)) // do not probe into the reset itself
  while (Date.now() < until) {
    if (useStore.getState().connected && (await window.recta.rescueProbe(1500))) return true
    await new Promise((r) => setTimeout(r, 700))
  }
  return false
}

/** Read the board and report every line the file and the board disagree on. */
async function diff(lines: string[]): Promise<{ line: string; now: string | null }[]> {
  const actual = await readBack()
  const out: { line: string; now: string | null }[] = []
  for (const line of lines) {
    const m = /^\$(\d+)=(.*)$/.exec(line)
    if (!m) continue
    const now = actual.get(m[1])
    if (now === undefined) out.push({ line, now: null })
    else if (!same(now, m[2].trim())) out.push({ line, now })
  }
  return out
}

/** Wait until nothing has arrived from the board for a moment, so a reply left over
 *  from somebody else's command cannot be mistaken for an answer to ours. */
function quiet(idleMs = 600, maxMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (): void => {
      off?.()
      off = null
      if (timer) clearTimeout(timer)
      resolve()
    }
    const bump = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(finish, idleMs)
    }
    off = window.recta.onEvent((ev) => {
      if (ev.type === 'line' && off) bump()
    })
    bump()
    setTimeout(finish, maxMs)
  })
}
