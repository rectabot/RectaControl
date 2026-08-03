/** Wires renderer requests (ipcMain.handle) to the Controller, and forwards
 *  controller events to the renderer over a single 'controller:event' channel. */

import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { Controller } from './controller'
import { logDir, logEvent, logFromUi } from './logger'
import { buildReport } from './report'
import { installUpdate, pendingUpdate, startUpdater } from './updater'
import { listPorts, pickBoardPort } from './transport/serial'
import { type RescueAction, sendBlind } from './rescue'
import { pickSettingsFile, readBackup, saveExport } from './settingsBackup'
import { detectBoard, dismissDriveWindow, flashFile, listVariants, pickUf2 } from './firmware'
import {
  fmDelete,
  fmDownload,
  fmDownloadToLib,
  fmList,
  fmMkdir,
  fmRename,
  fmUpload,
  fmUploadContent
} from './ftp'
import { libDelete, libImport, libList, libRead, libReveal, libWrite } from './library'
import { jog, setZero } from '@shared/grbl'
import type { ConnectOptions, ResumeMap } from '@shared/types'

export function registerIpc(getWindow: () => BrowserWindow | null): Controller {
  const controller = new Controller((event) => {
    // to disk first: the window may be gone, closing, or the very thing that broke
    logEvent(event)
    // A socket (esp. Ethernet) can still deliver data while the window is closing;
    // sending to a destroyed webContents throws "Object has been destroyed".
    const win = getWindow()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('controller:event', event)
    }
  })

  ipcMain.handle('ports:list', () => listPorts())

  // What a window asks the moment it exists, before it assumes anything.
  ipcMain.handle('link:state', () => controller.linkState)

  // The same answer, synchronously, for the one caller that cannot wait: the store's
  // initial state. An awaited answer arrives after the first frame is on screen, and
  // that frame showed a disconnected three-axis machine on a connected four-axis one —
  // the operator sees an axis appear out of nowhere on every reload. Blocking the
  // renderer is the wrong tool almost everywhere and exactly right here: it is one
  // property read, once, before there is anything to block.
  ipcMain.on('link:state:sync', (e) => {
    e.returnValue = controller.linkState
  })

  ipcMain.handle('connect', async (_e, opts: ConnectOptions) => {
    await controller.connect(opts)
  })

  ipcMain.handle(
    'autoConnect',
    (_e, opts: { ethHost: string; ethPort: number; baud: number }) => controller.autoConnect(opts)
  )

  ipcMain.handle('disconnect', () => controller.disconnect())

  ipcMain.handle('settings:markFactory', () => controller.markSettingsFactory())
  ipcMain.handle('settings:clearFactory', () => controller.clearSettingsFactory())

  // Rescue. Prefer the live connection; fall back to writing straight at a serial
  // port, because the board this exists for may never have answered at all.
  ipcMain.handle('rescue:send', async (_e, action: RescueAction, portPath?: string) => {
    if (controller.sendRescue(action)) return 'connection'
    const path = portPath ?? (await pickBoardPort())
    if (!path) throw new Error('no serial port to send the rescue sequence on')
    await sendBlind(path, action)
    return 'serial'
  })

  ipcMain.handle('rescue:probe', (_e, timeoutMs?: number) => controller.probeLine(timeoutMs))

  ipcMain.handle('settings:backups', () => controller.listSettingsBackups())
  ipcMain.handle('settings:readBackup', (_e, name: string) => readBackup(name))
  ipcMain.handle('settings:saveExport', (_e, text: string, label: string) => saveExport(text, label))
  ipcMain.handle('settings:pickFile', () => pickSettingsFile())

  ipcMain.handle('send', (_e, line: string) => controller.sendLine(line))

  ipcMain.handle('realtime', (_e, byte: number) => controller.sendRealtime(byte))

  ipcMain.handle('jog', (_e, axis: string, distance: number, feed: number) =>
    controller.sendLine(jog(axis, distance, feed))
  )

  ipcMain.handle('setZero', (_e, axis: string, value: number) =>
    controller.sendLine(setZero(axis, value))
  )

  ipcMain.handle('job:start', (_e, gcode: string, resume?: ResumeMap) =>
    controller.startJob(gcode, resume)
  )
  ipcMain.handle('job:pause', (_e, park?: boolean) => controller.pauseJob(park))
  ipcMain.handle('job:resume', () => controller.resumeJob())
  ipcMain.handle('job:stop', () => controller.stopJob())

  ipcMain.handle('firmware:list', () => listVariants())
  ipcMain.handle('firmware:detect', () => detectBoard())
  ipcMain.handle('firmware:pick', () => pickUf2())
  ipcMain.handle('firmware:dismissDriveWindow', (_e, drive: string, action: 'minimize' | 'close') =>
    dismissDriveWindow(drive, action)
  )

  // Hold the app in front for the length of a flash. Windows hands focus to the
  // folder window it opens on the bootloader drive, and the operator is then
  // watching a progress bar that is no longer on screen during the one operation
  // they must not interrupt. Pinned only between $UF2 and the board coming back —
  // an app that decides it is always the most important window is its own problem.
  ipcMain.handle('firmware:pinWindow', (_e, on: boolean) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.setAlwaysOnTop(on)
    if (on) {
      win.show() // no-op when visible; restores it if Windows minimised it
      win.focus()
    }
  })
  // Progress goes back to whoever asked for the flash, not to a remembered window:
  // the sender is the panel showing the bar, and if it has gone away mid-copy there
  // is nothing to tell.
  ipcMain.handle('firmware:flash', (e, uf2Path: string, drive: string) =>
    flashFile(uf2Path, drive, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send('firmware:progress', p)
    })
  )

  ipcMain.handle('fm:list', (_e, host: string, dir: string) => fmList(host, dir))
  ipcMain.handle('fm:upload', (_e, host: string, dir: string) => fmUpload(host, dir))
  ipcMain.handle('fm:download', (_e, host: string, path: string) => fmDownload(host, path))
  ipcMain.handle('fm:downloadLib', (_e, host: string, path: string) => fmDownloadToLib(host, path))
  ipcMain.handle('fm:uploadContent', (_e, host: string, path: string, content: string) =>
    fmUploadContent(host, path, content)
  )
  ipcMain.handle('fm:delete', (_e, host: string, path: string, isDir: boolean) =>
    fmDelete(host, path, isDir)
  )
  ipcMain.handle('fm:rename', (_e, host: string, from: string, to: string) =>
    fmRename(host, from, to)
  )
  ipcMain.handle('fm:mkdir', (_e, host: string, dir: string, name: string) =>
    fmMkdir(host, dir, name)
  )

  // local g-code library (PC)
  ipcMain.handle('lib:list', () => libList())
  ipcMain.handle('lib:read', (_e, name: string) => libRead(name))
  ipcMain.handle('lib:write', (_e, name: string, content: string) => libWrite(name, content))
  ipcMain.handle('lib:delete', (_e, name: string) => libDelete(name))
  ipcMain.handle('lib:import', () => libImport())
  ipcMain.handle('lib:reveal', () => libReveal())

  // on-disk log: the renderer contributes its own faults (a UI crash never
  // reaches main otherwise) and can open the folder for the operator
  ipcMain.handle('log:write', (_e, level: 'ui' | 'err', text: string) => logFromUi(level, text))
  ipcMain.handle('log:reveal', () => {
    shell.openPath(logDir())
  })

  // one zip with the log, the machine settings and the versions — written locally
  // and revealed in the file explorer; nothing leaves the PC (see report.ts)
  ipcMain.handle('report:build', (_e, note: string) => {
    const res = buildReport(controller.machineInfo, controller.connected, note)
    shell.showItemInFolder(res.path)
    return res
  })

  // automatic updates: main finds and downloads them, the renderer only shows the
  // toast and asks for the install — which is refused while a program is running
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:pending', () => pendingUpdate())
  ipcMain.handle('update:install', () => installUpdate(() => controller.isRunning))
  startUpdater((u) => {
    const win = getWindow()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('update:ready', u)
  })

  return controller
}
