/** Automatic updates.
 *
 *  A sender that ships a fix nobody installs has not fixed anything: the machine
 *  that hits the bug is in a workshop, not on a mailing list. So the app checks
 *  quietly on its own, downloads in the background, and only speaks up once a new
 *  version is sitting on disk ready to go — one click, a second of downtime.
 *
 *  Three rules it follows, all of them because this drives a machine:
 *
 *  - **Never mid-job.** `quitAndInstall` kills the process that is streaming, and
 *    the cut with it. The install is refused while a program runs and the operator
 *    is told to finish first.
 *  - **Never nag.** A shop PC is often off the network. A failed check is a line
 *    in the log, never a dialog. The toast appears for one reason only: an update
 *    is downloaded and ready.
 *  - **Portable builds are told, not touched.** electron-updater can only replace
 *    an installed (NSIS) app. The portable .exe may be running from a USB stick or
 *    a folder the user has no rights to write, so there the app just says a new
 *    version exists and opens the download page.
 *
 *  The feed is set here in code rather than through electron-builder's generated
 *  app-update.yml, so the portable build can check too, and so the app keeps
 *  working the same whether or not the releases repo exists yet: until it does,
 *  every check simply fails and logs.
 */

import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log } from './logger'
import type { InstallResult, UpdateReady } from '@shared/types'

/** Public repo that carries only the built binaries + latest.yml. The source
 *  repo stays private; a private feed would need a GitHub token inside the app. */
const FEED = { provider: 'github' as const, owner: 'rectabot', repo: 'RectaControl-releases' }
const RELEASES_URL = `https://github.com/${FEED.owner}/${FEED.repo}/releases/latest`

const CHECK_DELAY_MS = 15_000 // let the app finish starting (and connecting) first
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000 // and every six hours after that

/** electron-builder's portable target sets this; nothing else does. */
const isPortable = (): boolean => !!process.env.PORTABLE_EXECUTABLE_DIR

let pending: UpdateReady | null = null

/** Release notes arrive as HTML, as a list, or not at all — flatten to plain lines. */
function toLines(notes: unknown): string[] {
  const raw = Array.isArray(notes)
    ? notes.map((n) => (typeof n === 'string' ? n : ((n as { note?: string }).note ?? ''))).join('\n')
    : typeof notes === 'string'
      ? notes
      : ''
  return raw
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•*-]+/, '').trim())
    .filter(Boolean)
    .slice(0, 20)
}

/**
 * Wire the updater up: `notify` pushes a ready update to the renderer. Safe to
 * call in dev — it does nothing there (there is no packaged app to replace).
 */
export function startUpdater(notify: (u: UpdateReady) => void): void {
  if (!app.isPackaged) {
    log('app', 'updater idle — development build')
    return
  }

  const manual = isPortable()
  autoUpdater.setFeedURL(FEED)
  autoUpdater.autoDownload = !manual // a portable app has nothing to install into
  autoUpdater.autoInstallOnAppQuit = !manual // quitting is the one safe moment to swap the exe
  autoUpdater.logger = null // we keep our own log; theirs would duplicate every line

  autoUpdater.on('checking-for-update', () => log('app', 'update: checking'))
  autoUpdater.on('update-not-available', () => log('app', 'update: none — this is the current version'))

  autoUpdater.on('update-available', (info) => {
    log('app', `update: v${info.version} available${manual ? ' (portable — manual download)' : ', downloading'}`)
    // A portable build never reaches 'update-downloaded', so this is where it
    // tells the operator; an installed one waits until the file is on disk.
    if (manual) {
      pending = { version: info.version, notes: toLines(info.releaseNotes), manual: true }
      notify(pending)
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    log('app', `update: v${info.version} downloaded and ready to install`)
    pending = { version: info.version, notes: toLines(info.releaseNotes), manual: false }
    notify(pending)
  })

  // Offline, no releases repo yet, a rate limit: all normal, none worth a dialog.
  autoUpdater.on('error', (err) => log('app', `update: check failed — ${err?.message ?? err}`))

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => log('app', `update: check failed — ${err?.message ?? err}`))
  }
  const unref = (t: unknown): void => (t as { unref?: () => void }).unref?.()
  unref(setTimeout(check, CHECK_DELAY_MS))
  unref(setInterval(check, CHECK_EVERY_MS))
}

/** Install the downloaded update — unless a program is running, in which case the
 *  answer is "finish the job first" and the update stays where it is. */
export function installUpdate(isBusy: () => boolean): InstallResult {
  if (!pending) return { ok: false, reason: 'none' }
  if (isBusy()) {
    log('app', 'update: install refused — a program is running')
    return { ok: false, reason: 'busy' }
  }
  if (pending.manual) {
    log('app', 'update: portable build — opening the download page')
    shell.openExternal(RELEASES_URL)
    return { ok: false, reason: 'manual' }
  }
  log('app', `update: installing v${pending.version} — quitting now`)
  // silent install, then relaunch: the operator asked for this and does not need
  // to click through the setup wizard again. Delayed so the IPC reply reaches the
  // renderer before the process goes away.
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 200)
  return { ok: true }
}

/** The update already found, for a window that opened after the toast fired. */
export function pendingUpdate(): UpdateReady | null {
  return pending
}
