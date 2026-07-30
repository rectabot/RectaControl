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
  onProgress?: (done: number, total: number) => void
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
    const refused: string[] = []
    let done = 0
    for (const line of lines) {
      if (await sendSetting(line)) refused.push(line)
      onProgress?.(++done, lines.length)
    }
    for (const line of refused) await sendSetting(line)

    // Verify by reading the board, not by trusting what came back while writing.
    // A restore that reports success and leaves soft limits off is the failure
    // this whole routine exists to prevent, and on 30 Jul 2026 it did exactly
    // that — every line acked, `$20` still 0.
    const actual = await readBack()
    const missed: string[] = []
    for (const line of lines) {
      const m = /^\$(\d+)=(.*)$/.exec(line)
      if (!m) continue
      const now = actual.get(m[1])
      if (now === undefined) missed.push(`${line} → not on this board`)
      else if (!same(now, m[2].trim())) missed.push(`${line} → board says ${now}`)
    }

    return { total: lines.length, refused: missed }
  } finally {
    useStore.getState().setBulkWriting(false)
  }
}
