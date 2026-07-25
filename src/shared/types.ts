/** Shared types used across main, preload and renderer. */

export type TransportKind = 'usb' | 'ethernet'

export interface UsbConnectOptions {
  kind: 'usb'
  port: string
  baud: number
}

export interface EthernetConnectOptions {
  kind: 'ethernet'
  host: string
  port: number
}

export type ConnectOptions = UsbConnectOptions | EthernetConnectOptions

export interface SerialPortInfo {
  path: string
  manufacturer?: string
}

/** Parsed grbl/grblHAL status report. */
export interface StatusReport {
  state: string // Idle, Run, Jog, Hold, Alarm, Home, Door, Check, Sleep
  /** Work position (MPos - WCO), always in mm. One entry per axis (X,Y,Z,A,…). */
  wpos: number[] | null
  /** Raw machine position, always in mm. One entry per axis. */
  mpos: number[] | null
  feed: number | null
  /** Programmed/commanded spindle speed (FS 2nd value). */
  spindle: number | null
  /** Actual spindle RPM read back from the VFD (FS 3rd value), or null. */
  spindleActual: number | null
  /** Accessory state letters from the A: field (S=spindle CW, C=CCW, F=flood, M=mist). */
  accessory: string | null
  /** Active override percentages [feed, rapid, spindle] if reported. */
  ov: [number, number, number] | null
  /** Pin state letters from Pn: field (e.g. "PXYZ"), or null. */
  pins: string | null
}

export interface MachineInfo {
  version: string | null
  board: string | null
  options: string | null
  /** Axis letters reported by `[AXS:n:XYZA]` in $I, e.g. ['X','Y','Z','A']. */
  axes: string[]
  /** Active spindle name from `[SPINDLE:...]` in $I, e.g. 'PWM' or 'Huanyang'. */
  spindle: string | null
  /** Registered spindles enumerated from `$SPINDLESH` (machine-readable), so the
   *  $395 "Default spindle" picker lists the drivers this firmware actually has
   *  (analog PWM + every compiled Modbus VFD) instead of a hard-coded 0/1. */
  spindles: SpindleInfo[]
}

/** One registered spindle from the machine-readable `$SPINDLESH` enumeration
 *  (`[SPINDLE:id|num|type|caps|name|rpmMin,rpmMax]`). `id` is the value $395 takes. */
export interface SpindleInfo {
  /** Registration id — the number written to $395 to make this the default spindle. */
  id: number
  /** Human name reported by the driver, e.g. 'PWM', 'Huanyang v1', 'Durapulse GS20'. */
  name: string
  /** grblHAL spindle type number (spindle_control.h): 11 = PWM0 analog, 1 = Huanyang1… */
  type: number
  /** True when this is the currently selected/active spindle (`*` in the caps field). */
  active: boolean
}

/** Streaming job progress. */
export interface JobProgress {
  running: boolean
  paused: boolean
  total: number // total lines
  sent: number // lines acknowledged
  elapsedMs: number
  etaMs: number | null
  /** True on the one final event when a job finished NORMALLY (all lines acked),
   *  carrying the real wall-clock duration. Absent on stop/abort so a partial run
   *  never overwrites a program's known run time. */
  done?: boolean
}

/** Events the main process pushes to the renderer. */
export type ControllerEvent =
  | { type: 'status'; data: StatusReport }
  | { type: 'line'; data: string } // any non-status line from controller (ok, [..], error, ALARM)
  | { type: 'sent'; data: string } // a line we sent (for console echo)
  | { type: 'connected'; data: { kind: TransportKind } }
  | { type: 'disconnected'; data: { reason?: string } }
  | { type: 'info'; data: MachineInfo }
  | { type: 'job'; data: JobProgress }
  | { type: 'active'; data: number } // file line index now executing (from ack count), -1 = none
  | { type: 'error'; data: string }

/** Maps a resume (From Line) job back to the original file: the streamed program
 *  is a synthetic preamble + the tail of the file, so the highlight needs to know
 *  where in the real file each streamed line lives. */
export interface ResumeMap {
  fileLine: number // file index the resume targets (preamble lines map here)
  preambleLines: number // number of synthetic preamble lines before the file tail
}

/** A prebuilt firmware image available to flash. */
export interface FirmwareVariant {
  id: string // "<folder>/<file>"
  label: string
  uf2Path: string
  sizeKB: number
}

/** A detected RP2 UF2 bootloader mass-storage drive. */
export interface BoardDrive {
  drive: string // e.g. "E:\\"
  model: string // from INFO_UF2.TXT, e.g. "Raspberry Pi RP2350"
}

/** An entry in the controller's SD-card filesystem (via FTP). */
export interface FmEntry {
  name: string
  isDir: boolean
  size: number
}

/** API surface exposed to the renderer via contextBridge (window.recta). */
export interface RectaApi {
  listPorts(): Promise<SerialPortInfo[]>
  connect(opts: ConnectOptions): Promise<void>
  /** Try Ethernet first, then USB. Returns the kind that connected, or null. */
  autoConnect(opts: {
    ethHost: string
    ethPort: number
    baud: number
  }): Promise<TransportKind | null>
  disconnect(): Promise<void>
  send(line: string): Promise<void>
  realtime(byte: number): Promise<void>
  jog(axis: string, distance: number, feed: number): Promise<void>
  setZero(axis: string, value: number): Promise<void>
  startJob(gcode: string, resume?: ResumeMap): Promise<void>
  pauseJob(): Promise<void>
  resumeJob(): Promise<void>
  stopJob(): Promise<void>
  /** Firmware flashing (RP2350 UF2 bootloader). */
  listFirmware(): Promise<FirmwareVariant[]>
  detectBoard(): Promise<BoardDrive | null>
  pickFirmware(): Promise<string | null>
  flashFirmware(uf2Path: string, drive: string): Promise<void>
  /** SD-card file management over FTP. */
  fmList(host: string, dir: string): Promise<FmEntry[]>
  fmUpload(host: string, dir: string): Promise<string[]>
  fmDownload(host: string, path: string): Promise<string | null>
  /** Download an SD file straight into the PC library; returns the saved name. */
  fmDownloadToLib(host: string, path: string): Promise<string>
  /** Overwrite (or create) an SD-card file with text content. */
  fmUploadContent(host: string, path: string, content: string): Promise<void>
  fmDelete(host: string, path: string, isDir: boolean): Promise<void>
  fmRename(host: string, from: string, to: string): Promise<void>
  fmMkdir(host: string, dir: string, name: string): Promise<void>
  /** Local g-code library on the PC (a RectaControl-managed folder). */
  libList(): Promise<FmEntry[]>
  libRead(name: string): Promise<string>
  libWrite(name: string, content: string): Promise<void>
  libDelete(name: string): Promise<void>
  libImport(): Promise<string[]>
  libReveal(): Promise<void>
  /** Subscribe to controller events; returns an unsubscribe function. */
  onEvent(cb: (e: ControllerEvent) => void): () => void
  /** Main asks (X clicked mid-job) whether to quit; returns an unsubscribe fn. */
  onCloseRequest(cb: () => void): () => void
  /** Tell main to proceed with quitting after the user confirmed. */
  confirmClose(): Promise<void>
  /** Set the UI scale: a number pins a manual override, null returns to auto-fit. */
  setZoom(factor: number | null): Promise<void>
  /** Subscribe to the effective zoom factor (auto-fit or override); unsubscribe fn. */
  onZoom(cb: (factor: number) => void): () => void
}
