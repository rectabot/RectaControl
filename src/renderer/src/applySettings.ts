/** Write a saved `$$` dump back to the board, line by line, and say what stuck.
 *
 *  Shared by the Settings import button and the guided recovery, which finishes by
 *  putting the machine's own numbers back on a board that has just been reset to
 *  factory. There must be exactly one of these: a restore that quietly drops a line
 *  is worse than one that refuses out loud, and it is not a thing to get right twice.
 */

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

export interface ApplyResult {
  /** how many `$n=v` lines the file held */
  total: number
  /** `$n=v → error:n` for everything still refused after the retry pass */
  refused: string[]
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

  const refused: string[] = []
  let done = 0
  for (const line of lines) {
    if (await sendSetting(line)) refused.push(line)
    onProgress?.(++done, lines.length)
  }

  const stillRefused: string[] = []
  for (const line of refused) {
    const err = await sendSetting(line)
    if (err) stillRefused.push(`${line} → ${err}`)
  }

  return { total: lines.length, refused: stillRefused }
}
