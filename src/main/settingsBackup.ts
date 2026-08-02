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

import { app, dialog } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { vfdAddressMissing } from '@shared/settings-file'
import type { BackupRow, SpindleInfo } from '@shared/types'
import { log } from './logger'

/** Dated copies to retain — of DISTINCT machines, which is the number that means
 *  something. It was 30, and 30 turned out to be 7: measured on 2 Aug 2026, the
 *  folder held 30 dated dumps carrying 7 different contents, one of them repeated
 *  eleven times. The duplicates came from settings that toggle with a reboot (`$476`
 *  exists only when the board came up with a VFD), so every restart wrote another
 *  copy of a file already on disk. None of that is history; it is the same fact
 *  written down eleven times, in a list somebody has to choose from with their
 *  machine erased. Five distinct states is more real history than thirty was. */
const KEEP_DATED = 5
/** Factory and partial dumps are kept for diagnosis — what did the board come up on
 *  — and are never offered as a restore source, so they cost nothing but disk. They
 *  were nevertheless unbounded, which is its own kind of bug. */
const KEEP_ASIDE = 10
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
 *  so before it starts, not after.
 *
 *  Each row also carries what is IN the file, because a date alone is not enough to
 *  choose by. Sixty rows of timestamps look identical, and the one thing that
 *  distinguishes them — how many settings, and whether the VFD address is among them
 *  — was already known to us and told to the operator only AFTER the restore, when
 *  the board had been erased and the choice could no longer be changed. Knowledge in
 *  the wrong moment is no knowledge at all; it belongs where the picking happens. */
export function listBackups(spindles: SpindleInfo[] = []): BackupRow[] {
  try {
    const dir = settingsDir()
    // The other end of the clean-up (see tidy): whoever is about to READ this list is
    // the person the limits exist for, and this is the one moment we are certain they
    // are looking. Cheap, idempotent, and it runs before the list is built, so what
    // comes back is what is actually on disk.
    const kept = tidy(dir)
    const rows: BackupRow[] = readdirSync(dir)
      .filter((f) => f === 'latest.txt' || f.startsWith('settings_') || isExport(f))
      .map((name) => {
        const text = kept.get(name) ?? readBackup(name) ?? ''
        return {
          name,
          kind: name === 'latest.txt' ? 'latest' : isExport(name) ? 'export' : 'history',
          label: exportLabel(name),
          taken: statSync(join(dir, name)).mtime.toISOString(),
          count: text.split(/\r?\n/).filter((l) => /^\s*\$\d+=/.test(l)).length,
          vfdMissing: vfdAddressMissing(text, spindles)
        }
      })
    // Exports first — they are the answer to "which one is the good one" and the
    // reason the rest of the list can stay short — then the board's current state,
    // then what it held before that. Within a group, newest first.
    const rank = { export: 0, latest: 1, history: 2 }
    rows.sort((a, b) => rank[a.kind] - rank[b.kind] || b.taken.localeCompare(a.taken))
    return rows
  } catch {
    return []
  }
}

/** Save a dump the operator asked to keep — what the Export button does.
 *
 *  Everything else in this folder is written by the app, on its own, describing
 *  whatever the board happened to hold at the time. That is the right way to keep a
 *  safety net (a backup nobody has to remember to make is the only kind that exists
 *  when it is needed) and the wrong way to answer "is my machine still the one I set
 *  up?" — nothing automatic can know which of thirty dumps was the good one. Somebody
 *  pressing Export does know: they press it when the machine is where they want it.
 *
 *  Exports are few by nature and are never pruned. The label is the operator's own
 *  words — six months on, "after the VFD went in" is worth more than a date, and the
 *  date is there anyway.
 */
export function saveExport(text: string, label: string): string {
  const dir = settingsDir()
  // The label lands in a filename, so it is stripped to something a filesystem and a
  // human can both read. Empty is fine and common — then the date is the name.
  const slug = label
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const name = `export_${stamp()}${slug ? `_${slug}` : ''}.txt`
  writeFileSync(join(dir, name), text, 'utf8')
  log('app', `settings exported: ${name}`)
  return name
}

/** `baseline_` was this file's name for the few hours between building the idea and
 *  Filip pointing out that Export already meant it. Recognised so the one that exists
 *  is not orphaned; nothing writes it any more. */
const EXPORT_RE = /^(?:export|baseline)_(\d{4}-\d{2}-\d{2}_\d{4})(?:_(.+))?\.txt$/

const isExport = (name: string): boolean => EXPORT_RE.test(name)

/** The words the operator typed, recovered from the filename. */
function exportLabel(name: string): string {
  const m = EXPORT_RE.exec(name)
  return m?.[2] ? m[2].replace(/-/g, ' ') : ''
}

/** Choose a settings file to restore from, starting IN the folder they all live in.
 *
 *  The import used a plain file input, which opens wherever the OS last left off —
 *  usually Downloads, never here. Since every saved dump now lands in one place, the
 *  picker should open standing in it: the file you want is the one under the cursor.
 *  Anywhere else on disk is still reachable, because a file mailed by somebody else
 *  is a real thing to import. */
export async function pickSettingsFile(): Promise<{ name: string; text: string } | null> {
  const res = await dialog.showOpenDialog({
    title: 'Choose a settings file',
    defaultPath: settingsDir(),
    filters: [{ name: 'Settings', extensions: ['txt'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return null
  try {
    const path = res.filePaths[0]
    return { name: basename(path), text: readFileSync(path, 'utf8') }
  } catch {
    return null
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

/** Dated automatic copies, oldest first — the names carry the date, so a plain sort
 *  is a chronological one. */
function datedFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith('settings_'))
    .sort()
}

/** Keep the newest `keep` of `files` (oldest first) and delete the rest. */
function prune(dir: string, files: string[], keep: number): void {
  for (const old of files.slice(0, Math.max(0, files.length - keep)))
    rmSync(join(dir, old), { force: true })
}

/** Bring the folder back inside its limits.
 *
 *  Called from BOTH ends, and that is the fix rather than the tidiness: hanging the
 *  clean-up off the write path alone meant a folder full of duplicates stayed full
 *  until somebody happened to change a setting. Filip saw exactly that — the new
 *  rules were in, the old pile was still there, and nothing he could do would clear
 *  it because clearing it was waiting on an event that had no reason to come.
 *
 *  Duplicates go FIRST, and by content rather than by age. Capping to the newest five
 *  files is not the same as keeping five states: among thirty dumps holding seven
 *  distinct contents, the five newest can easily be three machines. The oldest copy
 *  of each content is the one kept — "these settings have existed since 30 Jul" is a
 *  more useful thing for a row to say than "…and also at 13:04, and 13:07, and 13:09".
 */
/** Returns the dated files that survived, with the contents already read — the caller
 *  is usually about to want exactly that, and reading every file twice per call is a
 *  cost paid on the main process, which is where the board's connection lives. */
function tidy(dir: string): Map<string, string> {
  const kept = new Map<string, string>()
  try {
    const seen = new Set<string>()
    for (const f of datedFiles(dir)) {
      // oldest first, so the survivor of a duplicate set is the earliest one
      let text: string
      try {
        text = readFileSync(join(dir, f), 'utf8')
      } catch {
        continue // unreadable: leave it alone rather than delete what we cannot see
      }
      if (seen.has(text)) rmSync(join(dir, f), { force: true })
      else {
        seen.add(text)
        kept.set(f, text)
      }
    }
    const over = [...kept.keys()].slice(0, Math.max(0, kept.size - KEEP_DATED))
    for (const f of over) {
      rmSync(join(dir, f), { force: true })
      kept.delete(f)
    }
    // The diagnostic piles never had a ceiling at all.
    for (const kind of ['factory_', 'partial_'])
      prune(dir, readdirSync(dir).filter((f) => f.startsWith(kind)).sort(), KEEP_ASIDE)
  } catch {
    // housekeeping is never worth failing a backup — or a settings read — over
  }
  return kept
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

  /** The saved dumps, described against what this firmware actually registers —
   *  which is the only way to tell a complete PWM backup from a VFD one that is
   *  missing its address. Goes through here because that knowledge lives here. */
  list(): ReturnType<typeof listBackups> {
    return listBackups(this.spindles)
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

      // …and the same test against everything already filed, not merely against the
      // dump before this one. Comparing with the previous alone lets A → B → A store
      // three files of which two are identical, and a setting that comes and goes with
      // a reboot makes exactly that pattern all day long. A dated copy earns its place
      // by holding a state no other copy holds.
      if (datedFiles(dir).some((f) => readFileSync(join(dir, f), 'utf8') === text)) return

      // Development convenience: if the source tree has a sibling `.private`
      // folder (it is gitignored and exists only on the maintainer's machine),
      // mirror the dump there under the name the debugging notes already point
      // at. No path is hardcoded and nothing happens for anyone else.
      if (!app.isPackaged) {
        const priv = join(app.getAppPath(), '..', '.private')
        if (existsSync(priv)) writeFileSync(join(priv, 'rectabot-settings.txt'), text, 'utf8')
      }

      writeFileSync(join(dir, `settings_${stamp()}.txt`), text, 'utf8')
      tidy(dir)
    } catch {
      // a backup is a convenience: never let a full disk or a locked file take
      // the connection down with it
    }
  }
}
