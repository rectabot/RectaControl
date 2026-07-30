/** Automatic settings backup.
 *
 *  Every `$$` dump the controller sends is written to disk, unchanged, as a plain
 *  list of `$n=v` lines. Two reasons, and the second is the one that pays:
 *
 *  1. A machine's settings are hours of tuning that live in a chip on the board.
 *     A failed flash, a `$RST=*`, or a swapped board loses them silently — and a
 *     backup nobody has to remember to make is the only kind that exists when it
 *     is needed.
 *  2. When something misbehaves, the settings are the first thing to read. A file
 *     that is always current turns "what is $21 on your machine?" into a fact
 *     instead of a round trip — and a stale answer there has already cost us an
 *     afternoon of chasing the wrong cause.
 *
 *  Files land in <Documents>/RectaControl/settings (override with
 *  RECTA_SETTINGS_DIR): `latest.txt` always holds the newest dump, plus a dated
 *  copy whenever the values actually changed, so the history stays readable
 *  rather than one file per connect.
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KEEP_DATED = 30 // dated copies to retain; a change a day for a month
const FLUSH_MS = 800 // quiet time after the last $n= line that ends a dump
const MIN_LINES = 20 // a real dump is ~100 lines; ignore a stray single setting

/** The backup folder, created on first use. Exported so the problem report can
 *  pack the machine settings alongside the log. */
export function settingsDir(): string {
  const dir = process.env.RECTA_SETTINGS_DIR || join(app.getPath('documents'), 'RectaControl', 'settings')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** The saved dumps, newest first, `latest.txt` always leading when it exists.
 *
 *  The guided recovery shows this before it erases anything: the operator is about
 *  to lose the machine's numbers, and a promise that they are safe somewhere is
 *  worth nothing next to the file name and the date they were taken. An empty list
 *  is itself the answer — it means there is no way back and the recovery has to say
 *  so before it starts, not after. */
export function listBackups(): { name: string; taken: string }[] {
  try {
    const dir = settingsDir()
    const rows = readdirSync(dir)
      .filter((f) => f === 'latest.txt' || f.startsWith('settings_'))
      .map((name) => ({ name, taken: statSync(join(dir, name)).mtime.toISOString() }))
    rows.sort((a, b) => (a.name === 'latest.txt' ? -1 : b.name === 'latest.txt' ? 1 : b.taken.localeCompare(a.taken)))
    return rows
  } catch {
    return []
  }
}

/** Read one saved dump back. Name-only, resolved inside the backup folder — a path
 *  from the renderer has no business reaching the rest of the disk. */
export function readBackup(name: string): string | null {
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null
  try {
    return readFileSync(join(settingsDir(), name), 'utf8')
  } catch {
    return null
  }
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

/** Collects `$n=v` lines off the wire and writes a dump once they stop coming. */
export class SettingsBackup {
  private buf = new Map<number, string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private factory = false

  /** The board has just been reset to defaults — whatever it dumps next describes
   *  the firmware, not this machine. Keep it (it is still evidence for a problem
   *  report) but do not let it become `latest.txt`, which is what a restore reaches
   *  for. Cleared by the dump it applies to. */
  markFactory(): void {
    this.factory = true
  }

  /** Feed every line the controller sends; non-setting lines are ignored. */
  feed(line: string): void {
    const m = /^\$(\d+)=(.*)$/.exec(line.trim())
    if (!m) return
    this.buf.set(Number(m[1]), m[2].trim())
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.write(), FLUSH_MS)
  }

  /** Drop a partial dump (disconnect mid-stream) rather than write half a machine. */
  reset(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.buf.clear()
  }

  private write(): void {
    this.timer = null
    const entries = [...this.buf.entries()].sort((a, b) => a[0] - b[0])
    this.buf.clear()
    if (entries.length < MIN_LINES) return // a single edited setting, not a dump

    const factory = this.factory
    this.factory = false

    const text = entries.map(([n, v]) => `$${n}=${v}`).join('\n') + '\n'
    try {
      const dir = settingsDir()
      const latest = join(dir, 'latest.txt')
      const previous = existsSync(latest) ? readFileSync(latest, 'utf8') : ''
      // `latest.txt` is what a restore reaches for, so it must keep describing the
      // machine. A dump that follows a wipe describes the firmware instead, and is
      // still written below as a dated copy — evidence, not a restore point.
      if (!factory) writeFileSync(latest, text, 'utf8')
      if (previous === text) return // nothing changed → no new dated copy

      // Development convenience: if the source tree has a sibling `.private`
      // folder (it is gitignored and exists only on the maintainer's machine),
      // mirror the dump there under the name the debugging notes already point
      // at. No path is hardcoded and nothing happens for anyone else.
      if (!app.isPackaged) {
        const priv = join(app.getAppPath(), '..', '.private')
        if (existsSync(priv)) writeFileSync(join(priv, 'rectabot-settings.txt'), text, 'utf8')
      }

      writeFileSync(join(dir, `settings_${stamp()}.txt`), text, 'utf8')
      const dated = readdirSync(dir)
        .filter((f) => f.startsWith('settings_'))
        .sort()
      for (const old of dated.slice(0, Math.max(0, dated.length - KEEP_DATED)))
        rmSync(join(dir, old), { force: true })
    } catch {
      // a backup is a convenience: never let a full disk or a locked file take
      // the connection down with it
    }
  }
}
