/** Wires renderer requests (ipcMain.handle) to the Controller, and forwards
 *  controller events to the renderer over a single 'controller:event' channel. */

import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { Controller } from './controller'
import { logDir, logEvent, logFromUi } from './logger'
import { buildReport } from './report'
import { installUpdate, pendingUpdate, startUpdater } from './updater'
import { listPorts } from './transport/serial'
import { detectBoard, flashFile, listVariants, pickUf2 } from './firmware'
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

  ipcMain.handle('connect', async (_e, opts: ConnectOptions) => {
    await controller.connect(opts)
  })

  ipcMain.handle(
    'autoConnect',
    (_e, opts: { ethHost: string; ethPort: number; baud: number }) => controller.autoConnect(opts)
  )

  ipcMain.handle('disconnect', () => controller.disconnect())

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
  ipcMain.handle('job:pause', () => controller.pauseJob())
  ipcMain.handle('job:resume', () => controller.resumeJob())
  ipcMain.handle('job:stop', () => controller.stopJob())

  ipcMain.handle('firmware:list', () => listVariants())
  ipcMain.handle('firmware:detect', () => detectBoard())
  ipcMain.handle('firmware:pick', () => pickUf2())
  ipcMain.handle('firmware:flash', (_e, uf2Path: string, drive: string) =>
    flashFile(uf2Path, drive)
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
