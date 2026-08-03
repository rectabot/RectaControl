import { app, shell, BrowserWindow, ipcMain, screen, Menu } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { log, startLog } from './logger'
import type { Controller } from './controller'

let mainWindow: BrowserWindow | null = null
let controller: Controller | null = null
/** Set once the user confirms quitting mid-job, so the vetoed close goes through. */
let forceQuit = false

/** UI scale. null = auto-fit to the display; a number = the user's manual override. */
let zoomOverride: number | null = null
let moveTimer: ReturnType<typeof setTimeout> | null = null

const clampZoom = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The colour behind everything: the window's own, and the one Chromium paints while a
 *  document is being replaced. It is the active theme's `bg-base`, which only the
 *  renderer knows — so the renderer reports it (ui:backdrop) and it is remembered here,
 *  and on disk, because the window is created before any renderer can say a word.
 *
 *  The default is the dark theme's, which is also the app's default. */
const BACKDROP_FALLBACK = '#020617'
let backdrop = BACKDROP_FALLBACK
const backdropFile = (): string => join(app.getPath('userData'), 'backdrop.json')

/** Remember it across restarts. Without this the first frame of every launch is the dark
 *  theme's background, which a light-theme machine shows as a dark flash before the
 *  stylesheet lands — the same seam as the reload, just once per start instead. */
function loadBackdrop(): void {
  try {
    const c = JSON.parse(readFileSync(backdropFile(), 'utf8')).color
    if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) backdrop = c
  } catch {
    /* first run, or the file is gone — the default is a fine answer */
  }
}

function setBackdrop(color: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(color) || color === backdrop) return
  backdrop = color
  mainWindow?.setBackgroundColor(color)
  try {
    writeFileSync(backdropFile(), JSON.stringify({ color }))
  } catch {
    /* it is a colour; not being able to remember it is not worth a dialog */
  }
}

/** Refresh the interface without throwing the document away.
 *
 *  The obvious `webContents.reload()` flashes white, and no amount of colour fixes it:
 *  between two documents Chromium composites against a base colour of its own, below the
 *  page, and Electron 32 exposes no way to set it — `setBackgroundColor` exists on the
 *  window and on BrowserView, not on WebContents. Twenty-four screenshots through that
 *  window (3 Aug 2026) caught the old document, then the new one already painted, and
 *  never a white pixel: the flash is not in the page, so it cannot be fixed in the page.
 *
 *  So don't leave the page. Everything a refresh is for — component state, effects, a
 *  view wedged in some impossible arrangement — lives in the React tree, and unmounting
 *  and rebuilding it costs no navigation, no bundle re-fetch and no white. It is also
 *  faster, and keeps the link and the machine's axes rather than rediscovering them.
 *
 *  If the window does not answer, it is wedged in a way a rebuild would not have fixed
 *  anyway, and the document reload — flash and all — is exactly the bigger hammer. */
let softAck: ReturnType<typeof setTimeout> | null = null
function reload(): void {
  const win = mainWindow
  if (!win) return
  win.webContents.send('app:rebuild')
  if (softAck) clearTimeout(softAck)
  softAck = setTimeout(() => {
    softAck = null
    log('app', 'the window did not rebuild itself — reloading the document instead')
    hardReload()
  }, 600)
}

/** Throw the document away and load it again. The error screen's way out, where the
 *  point is a clean slate: a rebuild keeps the store, and if the store is what broke,
 *  rebuilding onto it just breaks again. */
function hardReload(): void {
  mainWindow?.setBackgroundColor(backdrop)
  mainWindow?.webContents.reload()
}

/** Milliseconds since the process started.
 *
 *  "It takes a second longer to start than it used to" is a fair complaint and we
 *  had nothing on record to answer it with — the startup was one opaque block. Three
 *  marks split it into the parts that have different causes: the Electron runtime and
 *  our own imports (→ ready), the renderer bundle parsing and running (→ loaded), and
 *  the first paint (→ shown). Two numbers a launch, in a log we already collect. */
const bootMs = (): number => Math.round(process.uptime() * 1000)

/** Auto UI scale derived from the monitor the window sits on. workAreaSize is in
 *  DIPs (already divided by the OS scale factor), so basing the zoom on it respects
 *  Windows display-scaling and never double-scales on HiDPI panels. Reference height
 *  1040 ≈ a 1080p desktop's usable height → zoom 1.0 (the size everything was tuned
 *  at); bigger panels scale up, smaller ones down. Snapped to 0.05 steps. */
function autoZoom(): number {
  const disp = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay()
  return clampZoom(Math.round((disp.workAreaSize.height / 1040) * 20) / 20, 0.8, 1.6)
}

/** Apply the effective zoom (override if set, else auto) and tell the renderer,
 *  so the Settings control / % readout stays in sync. */
function applyZoom(): void {
  if (!mainWindow) return
  const z = zoomOverride ?? autoZoom()
  mainWindow.webContents.setZoomFactor(z)
  mainWindow.webContents.send('ui:zoom', z)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: backdrop,
    autoHideMenuBar: true,
    title: 'RectaControl',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  // Open maximized — the app is dense and looks cramped in a small window.
  // Maximize BEFORE show so the auto UI-scale (did-finish-load) fits full bounds.
  mainWindow.on('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
    log('app', `window shown at ${bootMs()} ms`)
  })

  // set the UI scale once the page is loaded (setZoomFactor is reset on navigation)
  mainWindow.webContents.on('did-finish-load', () => {
    log('app', `renderer loaded at ${bootMs()} ms`)
    applyZoom()
  })

  // re-fit when the window is dragged onto another monitor — but only in auto mode;
  // an explicit user choice is respected everywhere. Debounced (moved fires rapidly).
  mainWindow.on('moved', () => {
    if (zoomOverride !== null) return
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(applyZoom, 400)
  })

  // Guard against quitting mid-cut: if a program is streaming, veto the close and
  // ask the renderer to confirm (main can't render UI). The renderer calls back
  // 'app:confirm-close' once the user agrees, which sets forceQuit and re-closes.
  mainWindow.on('close', (e) => {
    if (forceQuit || !controller?.isRunning) return
    e.preventDefault()
    mainWindow?.webContents.send('app:close-request')
  })

  // Drop the reference and stop the transport so a late socket event can't emit
  // into a destroyed window ("Object has been destroyed").
  mainWindow.on('closed', () => {
    controller?.disconnect()
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // The window keys, bound here because the default menu is gone (below) and took the
  // accelerators with it. Only keyDown: this event fires for the release too, and F12
  // was toggling DevTools open and shut again on the one press, which is why it looked
  // dead.
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    if (process.env['ELECTRON_RENDERER_URL'] && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
      return
    }
    // Refresh the window. Nothing was bound to Ctrl+R or F5, so a window that had got
    // itself into a bad state could only be fixed by quitting the whole app — with the
    // machine connected and, quite possibly, mid-setup. It is bound in production too,
    // because that is where the operator is.
    //
    // This is only safe to offer since the link stopped living in the window: the
    // connection is the main process's, and a returning window rejoins it rather than
    // replacing it (see controller.connect).
    //
    // Safe mid-cut too, and deliberately not gated on it. A rebuild keeps the store —
    // the loaded file, the progress, the highlighted line all survive — so there is
    // nothing to warn about, and a modal in front of an operator watching a cut would
    // be the more dangerous of the two by some distance.
    if (input.key !== 'F5' && !((input.control || input.meta) && input.key.toLowerCase() === 'r')) return
    log('app', 'interface rebuilt')
    reload()
  })

  // electron-vite injects ELECTRON_RENDERER_URL in dev
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // before anything else can fail: the log is what a fault report is made of
  startLog()
  log('app', `main ready at ${bootMs()} ms`)

  // before the window exists, so it is created in the theme it will be shown in
  loadBackdrop()

  // drop the default application menu: it's hidden anyway (autoHideMenuBar) and its
  // View → Zoom roles bind Ctrl +/−/0, which would fight our own UI-scale handling.
  Menu.setApplicationMenu(null)

  controller = registerIpc(() => mainWindow)

  // renderer confirmed quitting mid-job → let the vetoed close proceed
  ipcMain.handle('app:confirm-close', () => {
    log('app', 'operator confirmed quitting while a job was running')
    forceQuit = true
    mainWindow?.close()
  })

  // renderer confirmed refreshing mid-job. The job itself is untouched — it streams
  // from this process — so this only rebuilds the window, but the log should say who
  // asked, because the progress and the highlight start again from nothing.
  // The window finished rebuilding itself, so the document reload standing by is not
  // needed. See reload().
  ipcMain.handle('app:rebuilt', () => {
    if (softAck) clearTimeout(softAck)
    softAck = null
  })

  // The ErrorBoundary's "Reload interface" button — the one case that wants the whole
  // document back, not a rebuild on top of whatever state produced the error.
  ipcMain.handle('app:reload', () => {
    log('app', 'interface reloaded after an error')
    hardReload()
  })

  // renderer reports the active theme's background, on mount and on every change. Only
  // it knows which theme is on; only main can paint between two documents.
  ipcMain.handle('ui:backdrop', (_e, color: string) => setBackdrop(color))

  // …and hands it straight back to the next document, through the preload, before that
  // document has a stylesheet or a first frame. See the preload for why this is the
  // only moment early enough.
  ipcMain.on('ui:backdrop:sync', (e) => {
    e.returnValue = backdrop
  })

  // renderer sets the UI scale: a number pins a manual override, null returns to
  // auto-fit. Guarded to a sane range so a bad value can't shrink the UI to nothing.
  ipcMain.handle('ui:setZoom', (_e, factor: number | null) => {
    zoomOverride = typeof factor === 'number' && Number.isFinite(factor) ? clampZoom(factor, 0.5, 2) : null
    applyZoom()
  })

  // resolution / display-scaling change → re-fit when auto
  screen.on('display-metrics-changed', () => {
    if (zoomOverride === null) applyZoom()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
