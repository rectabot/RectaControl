import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectOptions,
  ControllerEvent,
  FlashProgress,
  RectaApi,
  ResumeMap,
  UpdateReady
} from '@shared/types'

const api: RectaApi = {
  listPorts: () => ipcRenderer.invoke('ports:list'),
  connect: (opts: ConnectOptions) => ipcRenderer.invoke('connect', opts),
  autoConnect: (opts: { ethHost: string; ethPort: number; baud: number }) =>
    ipcRenderer.invoke('autoConnect', opts),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  markSettingsFactory: () => ipcRenderer.invoke('settings:markFactory'),
  clearSettingsFactory: () => ipcRenderer.invoke('settings:clearFactory'),
  rescueSend: (action: 'wipe' | 'bootsel', portPath?: string) =>
    ipcRenderer.invoke('rescue:send', action, portPath),
  rescueProbe: (timeoutMs?: number) => ipcRenderer.invoke('rescue:probe', timeoutMs),
  settingsBackups: () => ipcRenderer.invoke('settings:backups'),
  readSettingsBackup: (name: string) => ipcRenderer.invoke('settings:readBackup', name),
  send: (line: string) => ipcRenderer.invoke('send', line),
  realtime: (byte: number) => ipcRenderer.invoke('realtime', byte),
  jog: (axis: string, distance: number, feed: number) =>
    ipcRenderer.invoke('jog', axis, distance, feed),
  setZero: (axis: string, value: number) => ipcRenderer.invoke('setZero', axis, value),
  startJob: (gcode: string, resume?: ResumeMap) => ipcRenderer.invoke('job:start', gcode, resume),
  pauseJob: () => ipcRenderer.invoke('job:pause'),
  resumeJob: () => ipcRenderer.invoke('job:resume'),
  stopJob: () => ipcRenderer.invoke('job:stop'),
  listFirmware: () => ipcRenderer.invoke('firmware:list'),
  detectBoard: () => ipcRenderer.invoke('firmware:detect'),
  pickFirmware: () => ipcRenderer.invoke('firmware:pick'),
  flashFirmware: (uf2Path: string, drive: string) =>
    ipcRenderer.invoke('firmware:flash', uf2Path, drive),
  dismissDriveWindow: (drive: string, action: 'minimize' | 'close') =>
    ipcRenderer.invoke('firmware:dismissDriveWindow', drive, action),
  pinWindow: (on: boolean) => ipcRenderer.invoke('firmware:pinWindow', on),
  onFlashProgress: (cb: (p: FlashProgress) => void) => {
    const h = (_e: unknown, p: FlashProgress): void => cb(p)
    ipcRenderer.on('firmware:progress', h)
    return () => ipcRenderer.removeListener('firmware:progress', h)
  },
  fmList: (host: string, dir: string) => ipcRenderer.invoke('fm:list', host, dir),
  fmUpload: (host: string, dir: string) => ipcRenderer.invoke('fm:upload', host, dir),
  fmDownload: (host: string, path: string) => ipcRenderer.invoke('fm:download', host, path),
  fmDownloadToLib: (host: string, path: string) => ipcRenderer.invoke('fm:downloadLib', host, path),
  fmUploadContent: (host: string, path: string, content: string) =>
    ipcRenderer.invoke('fm:uploadContent', host, path, content),
  fmDelete: (host: string, path: string, isDir: boolean) =>
    ipcRenderer.invoke('fm:delete', host, path, isDir),
  fmRename: (host: string, from: string, to: string) =>
    ipcRenderer.invoke('fm:rename', host, from, to),
  fmMkdir: (host: string, dir: string, name: string) =>
    ipcRenderer.invoke('fm:mkdir', host, dir, name),
  libList: () => ipcRenderer.invoke('lib:list'),
  libRead: (name: string) => ipcRenderer.invoke('lib:read', name),
  libWrite: (name: string, content: string) => ipcRenderer.invoke('lib:write', name, content),
  libDelete: (name: string) => ipcRenderer.invoke('lib:delete', name),
  libImport: () => ipcRenderer.invoke('lib:import'),
  libReveal: () => ipcRenderer.invoke('lib:reveal'),
  logWrite: (level: 'ui' | 'err', text: string) => ipcRenderer.invoke('log:write', level, text),
  logReveal: () => ipcRenderer.invoke('log:reveal'),
  buildReport: (note: string) => ipcRenderer.invoke('report:build', note),
  appVersion: () => ipcRenderer.invoke('app:version'),
  pendingUpdate: () => ipcRenderer.invoke('update:pending'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateReady: (cb: (u: UpdateReady) => void) => {
    const listener = (_e: unknown, u: UpdateReady): void => cb(u)
    ipcRenderer.on('update:ready', listener)
    return () => ipcRenderer.removeListener('update:ready', listener)
  },
  onEvent: (cb: (e: ControllerEvent) => void) => {
    const listener = (_e: unknown, data: ControllerEvent): void => cb(data)
    ipcRenderer.on('controller:event', listener)
    return () => ipcRenderer.removeListener('controller:event', listener)
  },
  onCloseRequest: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:close-request', listener)
    return () => ipcRenderer.removeListener('app:close-request', listener)
  },
  confirmClose: () => ipcRenderer.invoke('app:confirm-close'),
  setZoom: (factor: number | null) => ipcRenderer.invoke('ui:setZoom', factor),
  onZoom: (cb: (factor: number) => void) => {
    const listener = (_e: unknown, factor: number): void => cb(factor)
    ipcRenderer.on('ui:zoom', listener)
    return () => ipcRenderer.removeListener('ui:zoom', listener)
  }
}

contextBridge.exposeInMainWorld('recta', api)
