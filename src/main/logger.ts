/** On-disk log.
 *
 *  Everything the terminal shows scrolls away, and it only exists while the app is
 *  open. When a customer writes "it stopped mid-job", the console they could have
 *  copied is already gone — and with it the one record of what the machine said.
 *  So the same stream is written to a file that survives the crash, the restart,
 *  and the week between the fault and the mail about it.
 *
 *  Files live in <userData>/logs (override with RECTA_LOG_DIR): `recta.log` is the
 *  current one, `recta.1.log` … `recta.4.log` the previous ones — five files of
 *  2 MB, so the folder is bounded at ~10 MB and still holds days of work.
 *
 *  Two things are deliberate:
 *
 *  - **Buffered, flushed on a timer.** A job acks ~20 lines a second; one
 *    filesystem call per line would put disk latency inside the streaming loop.
 *    Lines queue up and go out every 500 ms, so a crash costs at most half a
 *    second of log and never a millisecond of motion.
 *  - **`ok` is dropped while a job runs.** A 4000-line program answers with 4000
 *    bare `ok`s, which bury the one line that matters. The job's start and end are
 *    logged instead — exactly what the terminal does, and for the same reason.
 */

import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ControllerEvent } from '@shared/types'

const MAX_BYTES = 2 * 1024 * 1024 // per file
const KEEP = 5 // recta.log + recta.1..4.log
const FLUSH_MS = 500
const MAX_QUEUE = 5000 // a runaway emitter must not eat memory faster than we write

/** Where a line came from. Kept short so the column stays narrow and scannable. */
type Tag = 'app' | 'tx' | 'rx' | 'job' | 'ui' | 'err'

let queue: string[] = []
let timer: ReturnType<typeof setInterval> | null = null
let size = -1 // bytes in the current file; -1 = not measured yet
let dropped = 0 // lines lost to MAX_QUEUE, reported once we catch up
let jobRunning = false
let lastInfo = '' // dedupe the repeated `info` events one connect produces

/** The log folder, created on first use. */
export function logDir(): string {
  const dir = process.env.RECTA_LOG_DIR || join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const logPath = (n = 0): string => join(logDir(), n === 0 ? 'recta.log' : `recta.${n}.log`)

/** Existing log files, current one first — what the problem report packs up. */
export function logFiles(): string[] {
  return Array.from({ length: KEEP }, (_, i) => logPath(i)).filter((p) => existsSync(p))
}

function stamp(d = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  )
}

/** Queue one line. Never throws — logging must not be able to break the app. */
export function log(tag: Tag, text: string): void {
  if (queue.length >= MAX_QUEUE) {
    dropped++
    return
  }
  queue.push(`${stamp()}  ${tag.padEnd(3)}  ${text}`)
}

/** Write the queue out and rotate if the file has grown past its limit. */
export function flushLog(): void {
  if (!queue.length) return
  const lines = queue
  queue = []
  if (dropped) {
    lines.unshift(`${stamp()}  err  log queue overflowed — ${dropped} lines dropped`)
    dropped = 0
  }
  try {
    const path = logPath()
    if (size < 0) size = existsSync(path) ? statSync(path).size : 0
    // The batch is cut where it crosses the limit rather than written whole and
    // rotated afterwards — otherwise one busy flush could leave a file well over
    // 2 MB and the folder would no longer be bounded by KEEP × MAX_BYTES.
    let chunk = ''
    const write = (text: string): void => {
      appendFileSync(path, text, 'utf8')
      size += Buffer.byteLength(text)
    }
    for (const line of lines) {
      const piece = line + '\n'
      if (size + Buffer.byteLength(chunk) + Buffer.byteLength(piece) > MAX_BYTES) {
        if (chunk) {
          write(chunk)
          chunk = ''
        }
        rotate()
        size = 0
      }
      chunk += piece
    }
    if (chunk) write(chunk)
  } catch {
    // a full disk, a locked file, a folder the user deleted mid-session: none of
    // that is worth taking the machine down for. Drop the lines and carry on.
    size = -1
  }
}

/** recta.4.log falls off the end, everything shifts up one, a new recta.log starts. */
function rotate(): void {
  try {
    rmSync(logPath(KEEP - 1), { force: true })
    for (let n = KEEP - 2; n >= 0; n--) if (existsSync(logPath(n))) renameSync(logPath(n), logPath(n + 1))
  } catch {
    /* if rotation fails the file simply keeps growing — better than losing the log */
  }
}

/** Open the log for this run: header first, then the flush timer. Idempotent. */
export function startLog(): void {
  if (timer) return
  timer = setInterval(flushLog, FLUSH_MS)
  ;(timer as unknown as { unref?: () => void }).unref?.() // never hold the process open on our account

  log('app', '='.repeat(60))
  log('app', `RectaControl ${app.getVersion()} started`)
  log('app', `electron ${process.versions.electron} · chrome ${process.versions.chrome} · node ${process.versions.node}`)
  log('app', `${process.platform} ${process.arch} · ${app.isPackaged ? 'packaged' : 'dev'} · logs in ${logDir()}`)

  // Flush on the way out, both paths: `before-quit` covers the window closing,
  // `will-quit` covers app.quit() from anywhere else.
  app.on('before-quit', flushLog)
  app.on('will-quit', flushLog)

  // A rejected promise in an IPC handler (an FTP listing, a firmware probe) would
  // otherwise take the whole main process down under Node's default — and with it
  // a job that is mid-cut. Log it and keep streaming. Genuine fatals
  // (uncaughtException) are left alone: a crash should still be a crash.
  process.on('unhandledRejection', (reason) => {
    log('err', `unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
    flushLog()
  })
}

/** Mirror a controller event into the log, in the terminal's own shorthand.
 *  Status reports and progress ticks are skipped — they arrive 20×/s and say
 *  nothing a fault report needs. */
export function logEvent(e: ControllerEvent): void {
  switch (e.type) {
    case 'sent':
      return log('tx', e.data)
    case 'line':
      // while streaming, the acks are noise (see the file header); anything that
      // is not a plain `ok` — errors, alarms, `[MSG:…]` — always goes in
      if (jobRunning && e.data.trim() === 'ok') return
      return log('rx', e.data)
    case 'error':
      return log('err', e.data)
    case 'connected':
      return log('app', `connected over ${e.data.kind}`)
    case 'disconnected':
      return log('app', `disconnected${e.data.reason ? ` — ${e.data.reason}` : ''}`)
    case 'info': {
      const i = e.data
      const text =
        `machine: version=${i.version ?? '?'} board=${i.board ?? '?'} axes=${i.axes.join('') || '?'} ` +
        `spindle=${i.spindle ?? '?'} options=${i.options ?? '?'}`
      if (text === lastInfo) return // one connect emits `info` once per field parsed
      lastInfo = text
      return log('app', text)
    }
    case 'job': {
      const j = e.data
      if (j.running && !jobRunning) log('job', `start — ${j.total} lines`)
      else if (!j.running && jobRunning)
        log('job', `${j.done ? 'finished' : 'ended'} — ${j.sent}/${j.total} lines, ${Math.round(j.elapsedMs / 1000)} s`)
      jobRunning = j.running
      return
    }
    default:
      return // status / active: too frequent, and carried by the lines around them
  }
}

/** A line from the renderer (UI crash, window error) — see `log:write` in ipc.ts. */
export function logFromUi(level: 'ui' | 'err', text: string): void {
  log(level, text.length > 4000 ? text.slice(0, 4000) + ' …[truncated]' : text)
  if (level === 'err') flushLog() // a UI crash may be followed by a reload; don't wait
}
