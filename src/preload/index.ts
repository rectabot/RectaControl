import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectOptions, ControllerEvent, RectaApi, ResumeMap } from '@shared/types'

const api: RectaApi = {
  listPorts: () => ipcRenderer.invoke('ports:list'),
  connect: (opts: ConnectOptions) => ipcRenderer.invoke('connect', opts),
  autoConnect: (opts: { ethHost: string; ethPort: number; baud: number }) =>
    ipcRenderer.invoke('autoConnect', opts),
  disconnect: () => ipcRenderer.invoke('disconnect'),
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
