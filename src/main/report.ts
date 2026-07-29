/** Problem report — one file to send when something goes wrong.
 *
 *  "It stopped and I don't know why" is unanswerable without three things: what
 *  the machine said (the log), how the machine is configured (the last `$$`), and
 *  what it is running (firmware + app version). Each of those lives somewhere
 *  else on disk, and asking an operator to go find them is how a support thread
 *  dies. This packs all three into one `.zip`, drops it where they can see it, and
 *  hands back the list of what went in.
 *
 *  Nothing is sent anywhere. The file is written locally and the operator decides
 *  whether to attach it to a mail — a log carries the names of their programs, and
 *  a sender that phones home is not something a machinist should have to trust.
 *  That is also why the caller shows the contents list: the answer to "what is in
 *  this?" should be on screen before they send it, not buried in a privacy policy.
 */

import { app } from 'electron'
import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { flushLog, logFiles, log } from './logger'
import { settingsDir } from './settingsBackup'
import type { MachineInfo, ProblemReport } from '@shared/types'

const KEEP_REPORTS = 10 // old zips are worthless once a newer one exists

function reportsDir(): string {
  const dir = process.env.RECTA_REPORT_DIR || join(app.getPath('documents'), 'RectaControl', 'reports')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

/** The plain-text summary that sits at the root of the zip — readable without
 *  unpacking anything, and the first thing worth reading. */
function summary(info: MachineInfo, connected: boolean, note: string): string {
  const L: string[] = []
  L.push('RectaControl — problem report')
  L.push(`created         ${new Date().toString()}`)
  L.push('')
  L.push(`app             RectaControl ${app.getVersion()} (${app.isPackaged ? 'packaged' : 'dev'})`)
  L.push(`electron        ${process.versions.electron} · chrome ${process.versions.chrome} · node ${process.versions.node}`)
  L.push(`system          ${process.platform} ${process.arch}`)
  L.push('')
  L.push(`connected       ${connected ? 'yes' : 'no'}`)
  L.push(`firmware        ${info.version ?? 'unknown'}`)
  L.push(`board           ${info.board ?? 'unknown'}`)
  L.push(`options         ${info.options ?? 'unknown'}`)
  L.push(`axes            ${info.axes.join('') || 'unknown'}`)
  L.push(`active spindle  ${info.spindle ?? 'unknown'}`)
  if (info.spindles.length)
    L.push(`registered      ${info.spindles.map((s) => `${s.id}=${s.name}${s.active ? '*' : ''}`).join(', ')}`)
  L.push('')
  if (note.trim()) {
    L.push('What happened (written by the operator):')
    L.push(note.trim())
    L.push('')
  }
  L.push('Contents:')
  L.push('  report.txt        this summary')
  L.push('  logs/recta*.log   what the app and the machine said, newest first')
  L.push('  settings/         the machine settings ($$) as last read by the app')
  return L.join('\n') + '\n'
}

/** Build the zip. Returns its path and everything inside it. */
export function buildReport(info: MachineInfo, connected: boolean, note = ''): ProblemReport {
  flushLog() // the last half-second of log is usually the interesting one

  const zip = new AdmZip()
  zip.addFile('report.txt', Buffer.from(summary(info, connected, note), 'utf8'))

  for (const f of logFiles()) {
    try {
      zip.addLocalFile(f, 'logs')
    } catch {
      /* a log being rotated out from under us is not worth failing the report */
    }
  }

  // the settings backup writes `latest.txt` on every `$$` dump, plus dated copies
  // when values changed — take the current one and the newest few of the history,
  // which is what turns "it worked yesterday" into a diff
  try {
    const dir = settingsDir()
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .sort()
      .reverse()
      .slice(0, 6)
    for (const f of files) zip.addLocalFile(join(dir, f), 'settings')
  } catch {
    /* no backup yet (never connected) — the report is still worth having */
  }

  const path = join(reportsDir(), `rectacontrol-report_${stamp()}.zip`)
  zip.writeZip(path)
  prune()

  const entries = zip
    .getEntries()
    .map((e) => ({ name: e.entryName, size: e.header.size }))
    .sort((a, b) => a.name.localeCompare(b.name))

  log('app', `problem report written: ${path} (${entries.length} files, ${Math.round(statSync(path).size / 1024)} KB)`)
  return { path, entries }
}

/** Keep the reports folder from becoming its own problem. */
function prune(): void {
  try {
    const dir = reportsDir()
    const zips = readdirSync(dir)
      .filter((f) => f.startsWith('rectacontrol-report_') && f.endsWith('.zip'))
      .sort()
    for (const old of zips.slice(0, Math.max(0, zips.length - KEEP_REPORTS)))
      rmSync(join(dir, old), { force: true })
  } catch {
    /* nothing here is worth an error dialog */
  }
}
