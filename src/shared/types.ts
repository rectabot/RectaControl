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
  /** The controller's own homed status (|H: field), reported on change; null when
   *  this report did not carry it. Authoritative — grblHAL drops the reference by
   *  itself when a reset loses position, which cannot be inferred from outside. */
  homed: boolean | null
}

export interface MachineInfo {
  version: string | null
  board: string | null
  options: string | null
  /** Axis letters reported by `[AXS:n:XYZA]` in $I, e.g. ['X','Y','Z','A']. */
  axes: string[]
  /** Active spindle name from `[SPINDLE:...]` in $I, e.g. 'PWM' or 'Huanyang'. */
  spindle: string | null
  /** RectaBot's own build stamp from $I, e.g. '1.0 4axis-rotary-a Jul 29 2026'.
   *  Answers "which firmware is on this board" — grblHAL's version and the board
   *  name cannot. null on a board running anything but our firmware. */
  firmwareBuild: string | null
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

/** The machine layout an image was built for, read from the variant's build.conf
 *  so this never drifts from what was actually compiled. */
export interface VariantConfig {
  /** N_AXIS the image was built with. */
  axes: number
  /** Axis letters carrying a second motor, e.g. ['Y'] — ganged or auto-squared. */
  secondMotor: string[]
  /** True when that second motor has its own limit switch (auto-square). */
  autoSquare: boolean
}

/** A prebuilt firmware image available to flash. */
export interface FirmwareVariant {
  id: string // "<folder>/<file>"
  /** Variant folder name — also the token our build stamp reports in $I. */
  variant: string
  label: string
  uf2Path: string
  sizeKB: number
  /** What it was built for, or null when build.conf is missing/unreadable. */
  config: VariantConfig | null
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

/** A written problem-report zip: where it landed and what is inside it, so the UI
 *  can show the operator the contents before they decide to send it anywhere. */
export interface ProblemReport {
  path: string
  entries: { name: string; size: number }[]
}

/** An update the app has found. `manual` means it cannot install itself (portable
 *  build) and the operator will be sent to the download page instead. */
export interface UpdateReady {
  version: string
  notes: string[]
  manual: boolean
}

/** Why an install did not happen: a program is running, the build is portable, or
 *  there is nothing downloaded to install. */
export type InstallResult = { ok: true } | { ok: false; reason: 'busy' | 'manual' | 'none' }

/** How far a flash has got. `verify` is the read-and-check pass over the image
 *  (fast, no byte count worth showing); `write` is the copy onto the bootloader
 *  drive, which is where the eight seconds go. */
export interface FlashProgress {
  phase: 'verify' | 'write'
  done: number
  total: number
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
  /** Tell the settings backup that the next `$$` dump may be factory values, so it
   *  is kept as a dated copy but not promoted to `latest.txt` — the file a restore
   *  reaches for has to keep describing the machine, not the firmware. */
  markSettingsFactory(): Promise<void>
  /** The machine's own settings have been written back — end the factory window so
   *  the dump that confirms them is filed as a real backup again. */
  clearSettingsFactory(): Promise<void>
  /** Fire a rescue byte pair at the board: 'wipe' erases settings and reboots,
   *  'bootsel' reboots into the UF2 bootloader (USB only). Sent down the live
   *  connection when there is one, else written straight at a serial port — the
   *  board this exists for may never have answered. Resolves with which route was
   *  used; rejects only when there is no port at all. Needs firmware from 30 Jul
   *  2026 or later; older boards ignore the bytes, which is the safe direction. */
  rescueSend(action: 'wipe' | 'bootsel', portPath?: string): Promise<'connection' | 'serial'>
  /** Whether the board executes commands, as opposed to merely being alive. `?`
   *  cannot answer this — realtime bytes keep replying on a board whose line parser
   *  is suspended — so this asks `$I` and waits for an ordinary line. */
  rescueProbe(timeoutMs?: number): Promise<boolean>
  /** Saved `$$` dumps, newest first, `latest.txt` leading. Empty means there is no
   *  way back — which the recovery has to say before it erases anything.
   *
   *  `count` and `vfdMissing` are what the file HOLDS, carried so the operator picks
   *  by substance and not by timestamp — a row that is one setting short says so
   *  while the choice can still be changed, rather than after the erase. */
  settingsBackups(): Promise<
    { name: string; taken: string; count: number; vfdMissing: number | null }[]
  >
  readSettingsBackup(name: string): Promise<string | null>
  send(line: string): Promise<void>
  realtime(byte: number): Promise<void>
  jog(axis: string, distance: number, feed: number): Promise<void>
  setZero(axis: string, value: number): Promise<void>
  startJob(gcode: string, resume?: ResumeMap): Promise<void>
  /** `park` sends the door command instead of a feed hold, so grblHAL retracts the
   *  tool and parks it; Cycle Start reverses that and carries on. See RT.safetyDoor. */
  pauseJob(park?: boolean): Promise<void>
  resumeJob(): Promise<void>
  stopJob(): Promise<void>
  /** Firmware flashing (RP2350 UF2 bootloader). */
  listFirmware(): Promise<FirmwareVariant[]>
  detectBoard(): Promise<BoardDrive | null>
  pickFirmware(): Promise<string | null>
  flashFirmware(uf2Path: string, drive: string): Promise<void>
  /** Move the Explorer window Windows opens on the bootloader drive out of the
   *  way — minimised while the drive is live (it is the manual drag-and-drop
   *  fallback), closed once the board has rebooted and taken the drive with it. */
  dismissDriveWindow(drive: string, action: 'minimize' | 'close'): Promise<void>
  /** Keep the app above other windows — for the length of a flash, and no longer. */
  pinWindow(on: boolean): Promise<void>
  /** Follow a flash as it goes out. Returns an unsubscribe function. */
  onFlashProgress(cb: (p: FlashProgress) => void): () => void
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
  /** Add a line to the on-disk log. The renderer's own faults never reach main
   *  by themselves, and a UI crash is exactly what a fault report needs to carry. */
  logWrite(level: 'ui' | 'err', text: string): Promise<void>
  /** Open the log folder in the OS file explorer. */
  logReveal(): Promise<void>
  /** Pack the log + machine settings + versions into a .zip, reveal it in the file
   *  explorer, and return its path and contents. Nothing is uploaded anywhere. */
  buildReport(note: string): Promise<ProblemReport>
  /** The running app's own version (package.json / the installer's). */
  appVersion(): Promise<string>
  /** An update found before this window subscribed, or null. */
  pendingUpdate(): Promise<UpdateReady | null>
  /** Install the downloaded update and restart. Refused while a program runs. */
  installUpdate(): Promise<InstallResult>
  /** Subscribe to "an update is ready"; returns an unsubscribe function. */
  onUpdateReady(cb: (u: UpdateReady) => void): () => void
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
