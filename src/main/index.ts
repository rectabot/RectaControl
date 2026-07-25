import { app, shell, BrowserWindow, ipcMain, screen, Menu } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import type { Controller } from './controller'

let mainWindow: BrowserWindow | null = null
let controller: Controller | null = null
/** Set once the user confirms quitting mid-job, so the vetoed close goes through. */
let forceQuit = false

/** UI scale. null = auto-fit to the display; a number = the user's manual override. */
let zoomOverride: number | null = null
let moveTimer: ReturnType<typeof setTimeout> | null = null

const clampZoom = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

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
    backgroundColor: '#020617',
    autoHideMenuBar: true,
    title: 'RectaControl',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // set the UI scale once the page is loaded (setZoomFactor is reset on navigation)
  mainWindow.webContents.on('did-finish-load', () => applyZoom())

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

  // electron-vite injects ELECTRON_RENDERER_URL in dev
  if (process.env['ELECTRON_RENDERER_URL']) {
    // the default menu is gone (below), so keep a dev-only DevTools toggle
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12') mainWindow?.webContents.toggleDevTools()
    })
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // drop the default application menu: it's hidden anyway (autoHideMenuBar) and its
  // View → Zoom roles bind Ctrl +/−/0, which would fight our own UI-scale handling.
  Menu.setApplicationMenu(null)

  controller = registerIpc(() => mainWindow)

  // renderer confirmed quitting mid-job → let the vetoed close proceed
  ipcMain.handle('app:confirm-close', () => {
    forceQuit = true
    mainWindow?.close()
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
