import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type {
  ConnectOptions,
  ControllerEvent,
  FlashProgress,
  RectaApi,
  ResumeMap,
  UpdateReady
} from '@shared/types'

// Paint the document before it can be painted white.
//
// A reloaded document has no stylesheet for a moment, and Chromium's base colour for a
// document — which is separate from the window's, and is not what `setBackgroundColor`
// changes — is white. On a dark app that is a full-screen white flash on every Ctrl+R,
// and it read as the interface breaking rather than refreshing. index.html cannot fix it
// either: the right colour depends on the theme, which no static file knows, and the CSP
// rightly forbids the inline script that would look it up.
//
// The preload is the only code that runs after the document exists and before it is
// parsed, and it can ask main synchronously — main remembers the active theme's
// background across reloads and restarts. Written onto <html>, so it is the page's
// backdrop from the first frame; index.css takes over the instant it arrives, in the
// same colour.
// It has to be `webFrame.insertCSS`, and nothing that touches the DOM: at this point
// there IS no DOM. The preload runs before parsing starts, so `document.documentElement`
// is still null, and code that waits for it runs after parsing — which is after the
// white. That was the first attempt at this, and it did nothing.
try {
  const color = ipcRenderer.sendSync('ui:backdrop:sync')
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    webFrame.insertCSS(`html{background-color:${color}}`)
} catch {
  /* no colour is better than no window */
}

const api: RectaApi = {
  listPorts: () => ipcRenderer.invoke('ports:list'),
  pickBoardPort: () => ipcRenderer.invoke('ports:pick'),
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
  saveExport: (text: string, label: string) => ipcRenderer.invoke('settings:saveExport', text, label),
  pickSettingsFile: () => ipcRenderer.invoke('settings:pickFile'),
  send: (line: string) => ipcRenderer.invoke('send', line),
  realtime: (byte: number) => ipcRenderer.invoke('realtime', byte),
  jog: (axis: string, distance: number, feed: number) =>
    ipcRenderer.invoke('jog', axis, distance, feed),
  setZero: (axis: string, value: number) => ipcRenderer.invoke('setZero', axis, value),
  startJob: (gcode: string, resume?: ResumeMap) => ipcRenderer.invoke('job:start', gcode, resume),
  pauseJob: (park?: boolean) => ipcRenderer.invoke('job:pause', park),
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
  linkState: () => ipcRenderer.invoke('link:state'),
  linkStateSync: () => ipcRenderer.sendSync('link:state:sync'),
  reloadWindow: () => ipcRenderer.invoke('app:reload'),
  onRebuild: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:rebuild', listener)
    return () => ipcRenderer.removeListener('app:rebuild', listener)
  },
  rebuilt: () => ipcRenderer.invoke('app:rebuilt'),
  setZoom: (factor: number | null) => ipcRenderer.invoke('ui:setZoom', factor),
  setBackdrop: (color: string) => ipcRenderer.invoke('ui:backdrop', color),
  onZoom: (cb: (factor: number) => void) => {
    const listener = (_e: unknown, factor: number): void => cb(factor)
    ipcRenderer.on('ui:zoom', listener)
    return () => ipcRenderer.removeListener('ui:zoom', listener)
  }
}

contextBridge.exposeInMainWorld('recta', api)
