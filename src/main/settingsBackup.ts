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
import { vfdAddressMissing } from '@shared/settings-file'
import type { SpindleInfo } from '@shared/types'
import { log } from './logger'

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
  private factoryUntil = 0
  /** what `$SPINDLESH` says this firmware registers — decides whether a dump without
   *  `$476` is complete or one setting short (see vfdAddressMissing) */
  private spindles: SpindleInfo[] = []

  /** The controller hands over the spindle enumeration as it learns it. */
  setSpindles(list: SpindleInfo[]): void {
    this.spindles = list
  }

  /** The board has been reset to defaults — anything it dumps from here describes
   *  the firmware, not this machine.
   *
   *  A WINDOW, not a one-shot. It was a single flag once, consumed by the first dump
   *  that arrived, and that was wrong in the worst possible way: the app sends `$$`
   *  twice on connect, so the first factory dump was correctly turned away and the
   *  second overwrote `latest.txt` behind it. The guided recovery then read those
   *  factory values back and wrote them onto the machine, reporting success — a
   *  gantry left on 250 steps/mm and told it was recovered. Found on hardware,
   *  30 Jul 2026.
   *
   *  Cleared by clearFactory() when real settings have been written back, so the
   *  dump that confirms them is filed normally. */
  markFactory(windowMs = 120_000): void {
    this.factoryUntil = Date.now() + windowMs
  }

  /** The machine's own settings are back on the board; classify normally again. */
  clearFactory(): void {
    this.factoryUntil = 0
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

    const text = entries.map(([n, v]) => `$${n}=${v}`).join('\n') + '\n'
    try {
      const dir = settingsDir()

      // A factory dump is filed under its own name and goes no further. It is worth
      // keeping — a problem report wants to know what the board came up on — but it
      // must never be reachable as a restore source, and the classification happens
      // here, at the one moment we actually know. Deciding later, by looking at the
      // numbers, would be guessing at whether a machine legitimately has 250
      // steps/mm; this needs no guessing at all.
      if (Date.now() < this.factoryUntil) {
        writeFileSync(join(dir, `factory_${stamp()}.txt`), text, 'utf8')
        return
      }

      const latest = join(dir, 'latest.txt')
      const previous = existsSync(latest) ? readFileSync(latest, 'utf8') : ''

      // …and the quieter version of the same danger. A board that has not restarted
      // since a VFD was selected answers `$$` without `$476` — a complete-looking dump
      // that is one setting short, and the setting it is short of is the one nobody
      // notices missing. Letting it overwrite `latest.txt` would trade a good backup
      // for a lesser one at the moment the operator is changing spindles, which is
      // exactly when they are most likely to need the good one back.
      //
      // Only when there is something to lose: if the file already on disk has no
      // address either, this dump takes nothing away and is filed normally.
      const short = vfdAddressMissing(text, this.spindles) !== null && /^\$476=/m.test(previous)
      if (short) {
        writeFileSync(join(dir, `partial_${stamp()}.txt`), text, 'utf8')
        log('app', 'settings backup: dump has no $476 (board has not restarted with the VFD) — kept the previous latest.txt')
        return
      }

      writeFileSync(latest, text, 'utf8')
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
