/** Write a saved `$$` dump back to the board, line by line, and say what stuck.
 *
 *  Shared by the Settings import button and the guided recovery, which finishes by
 *  putting the machine's own numbers back on a board that has just been reset to
 *  factory. There must be exactly one of these: a restore that quietly drops a line
 *  is worse than one that refuses out loud, and it is not a thing to get right twice.
 */

import { useStore } from './store'
import { RECONNECT_GIVE_UP_MS } from './reconnect'
import { sameValue } from '@shared/settings-file'
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
  /** The restart was agreed to and sent, and the board never came back within the
   *  wait. Then `refused` is not a verdict — those settings were never put to a
   *  board at all, and saying they were refused blames a machine that was not
   *  asked. The remedy is different too: reconnect and import again, rather than
   *  go looking for why a setting will not take. */
  rebootLost?: boolean
}

/** Comparing a written value with what the board answers is the same question the
 *  baseline comparison asks, so there is one of it — see `sameValue`. */
const same = sameValue

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
/** Where the time goes, as a share of this routine's whole job. Writing dominates;
 *  the checks are a `$$` each; the restart is a boot. Rough, but each boundary is a
 *  real event — the bar only moves when something has actually finished, so it can
 *  jump forward and never has to go back. */
const PHASE = { write: 0.6, verify: 0.7, retry: 0.85, reboot: 1 }

export async function applySettings(
  text: string,
  /** 0..1 across everything this routine does, not just the writing loop. */
  onProgress?: (frac: number) => void,
  opts?: {
    /** May the board be restarted, to write what could not be written without one?
     *
     *  Some settings only exist while the thing they belong to is live, and that is
     *  decided at boot. `$476` (VFD ModBus address) exists only while a VFD is the
     *  default spindle, which comes from `$395` — read when the board starts. So on
     *  a board that just came up on factory defaults, writing `$395=1` switches the
     *  spindle at once but `$476` stays unavailable (error:53, "setting disabled")
     *  for the rest of that session, and the restore ends one setting short with no
     *  way to finish. The same is true of `$301` and the other boot-read settings.
     *
     *  Confirmed on hardware 30 Jul 2026: refused before a restart, `ok` after — and
     *  the whole way through on 1 Aug, from the refusal to the `$476=1` that stuck.
     *
     *  Asked HERE, at the moment the answer is known, rather than by the caller after
     *  the fact: an import used to be run a second time from the top to reach the
     *  restart, rewriting all 116 settings to get at the one that was missing. The
     *  refusals are passed in so the question can name them. Returning false (or
     *  leaving this out) reports them instead. */
    mayReboot?: (refused: string[]) => boolean | Promise<boolean>
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
      onProgress?.((++done / lines.length) * PHASE.write)
    }

    // A second pass fixes the ordering the file cannot express: a dump is written
    // in numeric order while `$20` (soft limits) is refused until `$22` (homing) is
    // on, several lines later.
    let missed = await diff(lines)
    onProgress?.(PHASE.verify)
    if (missed.length) {
      await quiet()
      for (const { line } of missed) await sendSetting(line)
      missed = await diff(lines)
    }
    onProgress?.(PHASE.retry)

    // Anything left may simply not exist yet on a board that has not restarted with
    // these settings in it — see mayReboot above. One restart, one more pass, and only
    // the lines that are actually still missing go out again.
    let rebootLost = false
    if (missed.length && opts?.mayReboot && (await opts.mayReboot(describe(missed)))) {
      opts.onReboot?.()
      window.recta.send('$REBOOT')
      if (await waitForBoard((f) => onProgress?.(PHASE.retry + f * (PHASE.reboot - PHASE.retry)))) {
        await quiet()
        for (const { line } of missed) await sendSetting(line)
        missed = await diff(lines)
      } else rebootLost = true
    }
    onProgress?.(PHASE.reboot)

    return { total: lines.length, refused: describe(missed), rebootLost }
  } finally {
    useStore.getState().setBulkWriting(false)
    // Writing a whole dump back IS the event that ends the factory window: whatever
    // the board reports from here describes this machine again. It used to be cleared
    // by the guided recovery alone, so a restore done from the Settings import left
    // the window open — and the dump that confirmed 116 restored settings was filed
    // as a factory copy while latest.txt kept the older, incomplete one. Found on
    // 30 Jul 2026 by Filip noticing his own variant reported one setting fewer than
    // the others. Belongs here, where both callers pass through.
    void window.recta.clearSettingsFactory()
  }
}

/** Wait for the board to come back and answer a line command. The app reconnects on
 *  its own after a reboot; this only has to wait for it and then check that the
 *  parser — not merely the link — is up.
 *
 *  The ceiling is the app's own give-up point, derived rather than guessed — see
 *  `reconnect.ts` for why the two must not be chosen separately. Waiting this long
 *  costs nothing while the board is quick (the poll below returns the moment the
 *  parser answers); the price is paid only when the board is truly not coming back,
 *  which is a thing worth being sure about before saying it. */
async function waitForBoard(
  onProgress?: (frac: number) => void,
  totalMs = RECONNECT_GIVE_UP_MS
): Promise<boolean> {
  const start = Date.now()
  await new Promise((r) => setTimeout(r, 2500)) // do not probe into the reset itself
  while (Date.now() - start < totalMs) {
    if (useStore.getState().connected && (await window.recta.rescueProbe(1500))) return true
    onProgress?.(Math.min(1, (Date.now() - start) / totalMs))
    await new Promise((r) => setTimeout(r, 700))
  }
  return false
}

/** One line per disagreement, in the words the operator sees. "not on this board" is
 *  load-bearing: it is what tells the caller a restart could still finish the job. */
function describe(missed: { line: string; now: string | null }[]): string[] {
  return missed.map((m) => (m.now === null ? `${m.line} → not on this board` : `${m.line} → board says ${m.now}`))
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
