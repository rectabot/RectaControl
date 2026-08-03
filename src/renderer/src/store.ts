import { create } from 'zustand'
import type { ControllerEvent, JobProgress, MachineInfo, StatusReport, TransportKind, UpdateReady } from '@shared/types'
import { describe, parseCode, getAlarm, getError } from '@shared/messages'
import { t, type Lang } from '@shared/i18n'
import { DEFAULT_BINDINGS, type Binding } from './controls'

const MAX_CONSOLE = 1000

/** What we know about the machine before it has said anything. Everything here is
 *  answered by `$I`, which only arrives a moment AFTER a connection opens — so
 *  this is also what a new connection resets to, rather than carrying the last
 *  board's answers into the next one. Flash a 3-axis firmware onto a machine the
 *  app had learned as 4-axis and the stale axis list met three fresh positions:
 *  the DRO asked for a fourth number that no longer existed. */
const EMPTY_INFO: MachineInfo = {
  version: null,
  board: null,
  options: null,
  axes: [],
  spindle: null,
  firmwareBuild: null,
  spindles: []
}

/** One terminal entry. `time` is when it arrived; `n` counts collapsed repeats
 *  (an identical consecutive line bumps the count instead of flooding). */
export interface ConsoleLine {
  text: string
  time: number
  n: number
}

/** Keyboard + gamepad control preferences (persisted). `feed`/`step` are in
 *  display units; `bindings` maps every action id → its key + pad button. */
export interface KbControls {
  keyboard: boolean
  gamepad: boolean
  mode: 'hold' | 'step'
  feed: number
  step: number
  bindings: Record<string, Binding>
}

const DEFAULT_CONTROLS: KbControls = {
  keyboard: true,
  gamepad: true,
  mode: 'hold',
  feed: 1000,
  step: 1,
  bindings: DEFAULT_BINDINGS
}

function loadControls(): KbControls {
  try {
    return { ...DEFAULT_CONTROLS, ...JSON.parse(localStorage.getItem('controls') || '{}') }
  } catch {
    return DEFAULT_CONTROLS
  }
}

/** A user macro: a named sequence of G-code / `$` commands, run line by line. */
export interface Macro {
  id: string
  name: string
  gcode: string
}

function loadMacros(): Macro[] {
  const raw = localStorage.getItem('macros')
  // first run ever (no key yet) → seed one example so the feature is discoverable.
  // Once the user edits/deletes (setMacros persists a key), we respect their list.
  if (raw == null) {
    // lift Z 5 mm (relative), then rapid to the work origin — a safe, everyday
    // example that doesn't depend on homing. Edit/delete it freely.
    return [{ id: crypto.randomUUID(), name: 'Go to work zero', gcode: 'G91 G0 Z5\nG90 G0 X0 Y0' }]
  }
  try {
    const m = JSON.parse(raw)
    return Array.isArray(m) ? m : []
  } catch {
    return []
  }
}

/** Touch-plate probe configuration (persisted). All the "how" of a Z touch-off
 *  lives here (Settings → Probe); the toolpath Probe button just runs it. */
export interface ProbeConfig {
  /** Touch-plate thickness in mm — work Z is set to this at contact. */
  thickness: number
  /** Probe feed rate (mm/min). */
  feed: number
  /** Max downward travel before giving up (mm). */
  maxTravel: number
  /** How far to lift after a successful probe (mm). */
  retract: number
}

const DEFAULT_PROBE: ProbeConfig = { thickness: 15, feed: 100, maxTravel: 25, retract: 5 }

function loadProbe(): ProbeConfig {
  try {
    return { ...DEFAULT_PROBE, ...JSON.parse(localStorage.getItem('probeConfig') || '{}') }
  } catch {
    return DEFAULT_PROBE
  }
}

/** ioSender-style probing parameters used by the full Probe panel (edge/corner/
 *  centre). Two-stage probing: a fast SEARCH approach, back off by `latchDistance`,
 *  then a slow LATCH re-probe for accuracy. All mm / mm-per-min. Persisted. */
export interface ProbeParams {
  /** Tool / probe tip diameter — edge & corner zeros land on the material edge. */
  tipDiameter: number
  /** Touch-plate/fixture thickness (Z touch-off sets Z to this at contact). */
  thickness: number
  /** Rail widths, per axis — `a` measures X, `b` measures Y, as labelled on the
   *  drawing in Settings. The true edge sits this far BEYOND the contact point
   *  (added to the tip radius). Different from the Z plate.
   *
   *  Two values even on a plate meant to be square, because these get made and
   *  come off the machine at whatever they came off at. Which rail is which
   *  follows from how the plate is turned, and the drawing fixes that: it is the
   *  FRONT-LEFT corner, the only corner the three-axis zero offers. */
  edgePlateX: number
  edgePlateY: number
  /** Fast first-approach feed. */
  searchFeed: number
  /** Slow re-probe feed (accuracy). */
  latchFeed: number
  /** Max travel searching for the surface before giving up. */
  probeDistance: number
  /** Back-off distance between search and latch. */
  latchDistance: number
  /** Sideways clearance when moving around a corner/boss between probes. */
  xyClearance: number
  /** How deep below the top surface to probe an edge/wall. */
  depth: number
  /** How far to move OUT past a face when doing a 3-axis external corner (from a
   *  start ~10–15 mm inside the corner) so the tool clears the edge before it
   *  drops down to probe the side. */
  approach: number
  /** How far to lift/back off after a completed probe. */
  retract: number
  /** How far along the front edge the skew cycle steps before touching it a second
   *  time. Longer is more accurate — the same measuring error spread over a longer
   *  baseline is a smaller angle — but it has to stay on the workpiece, so it is a
   *  property of the part in the vice, not of the machine. Lives with the other
   *  measuring parameters so that a number typed for a particular part survives
   *  closing the window. */
  skewSpacing: number
}

const DEFAULT_PARAMS: ProbeParams = {
  tipDiameter: 6,
  // A plate that measures three axes, in its own numbers: the field is 5 mm thick,
  // and each side rail is 15 mm wide. The material corner seats into the plate's
  // inside corner, so on square stock those 15 mm are exact, not a guess.
  thickness: 5,
  edgePlateX: 15,
  edgePlateY: 15,
  searchFeed: 200,
  latchFeed: 40,
  probeDistance: 25,
  latchDistance: 1,
  xyClearance: 5,
  depth: 5,
  approach: 22,
  retract: 3,
  skewSpacing: 50
}

/** A saved mode that no longer exists lands on Z, not on a blank panel. */
function loadProbeMode(): 'z' | 'edge' | 'rotate' {
  const saved = localStorage.getItem('probeMode')
  return saved === 'edge' || saved === 'rotate' ? saved : 'z'
}

function loadProbeParams(): ProbeParams {
  try {
    const saved = JSON.parse(localStorage.getItem('probeParams') || '{}')
    // `edgePlate` was one number for both rails. Carry a measured value across
    // rather than silently resetting it to a default — it describes a real plate
    // somebody put a caliper on, and losing it would move their zero without a word.
    if (typeof saved.edgePlate === 'number' && saved.edgePlateX === undefined) {
      saved.edgePlateX = saved.edgePlate
      saved.edgePlateY = saved.edgePlate
    }
    return { ...DEFAULT_PARAMS, ...saved }
  } catch {
    return DEFAULT_PARAMS
  }
}

/** Stock (raw material) block shown in the 3D view so you can see the tool cut
 *  into the workpiece. Positioned at the work origin; Z0 sits on the top or the
 *  bottom face. All mm. */
export interface StockConfig {
  enabled: boolean
  /** box = flat block (3-axis milling); rotary = 4th-axis (A) workpiece on a chuck. */
  mode: 'box' | 'rotary'
  x: number
  y: number
  z: number
  /** Which face of the stock the work Z0 is on. */
  zOrigin: 'top' | 'bottom'
  /** Where the work XY zero sits on the stock, as the CAM job defines it: a corner
   *  (front-left … back-right, machine convention +X right / +Y away) or the centre,
   *  which is what most CAM defaults to for a symmetric part. Display only — it
   *  moves the drawn block around the origin and changes nothing that is sent to
   *  the machine. Unrelated to the homing corner, which stays fixed. */
  originCorner: 'FL' | 'FR' | 'BL' | 'BR' | 'C'
  /** Rotary raw-stock cross-section: round bar (Ø) or square billet (across flats). */
  rotaryShape: 'round' | 'square'
  /** Rotary params — all mm. `diameter` for round; for square stock `side` is the
   *  width and `sideH` the height of the cross-section, which need not match —
   *  rectangular bar (50 × 60) is as common as true square. */
  diameter: number
  side: number
  sideH: number
  length: number
  /** Which linear axis the rotary A axis is parallel to. Per-job: the same table
   *  runs long parts along Y and a rotary chuck along X (or vice-versa). */
  rotaryAxis: 'X' | 'Y'
}

const DEFAULT_STOCK: StockConfig = {
  enabled: false,
  mode: 'box',
  x: 100,
  y: 100,
  z: 12,
  zOrigin: 'top',
  originCorner: 'FL',
  rotaryShape: 'round',
  diameter: 60,
  side: 60,
  sideH: 60,
  length: 200,
  rotaryAxis: 'X'
}

/** Radius the toolpath is wrapped around: the surface the tool actually works on.
 *  For a rectangular bar that is half the LARGER cross-section — the face furthest
 *  from the axis, which is what a CAM wrap is set up against. */
export function rotaryRadius(s: StockConfig): number {
  return (s.rotaryShape === 'round' ? s.diameter : Math.max(s.side, s.sideH)) / 2
}

/** Radius the stock SWEEPS as it turns — half the diagonal for a rectangular bar,
 *  since its corners reach furthest. Used to stand the bar on the table plane. */
export function rotarySweptRadius(s: StockConfig): number {
  return (s.rotaryShape === 'round' ? s.diameter : Math.hypot(s.side, s.sideH)) / 2
}

function loadStock(): StockConfig {
  try {
    const raw = JSON.parse(localStorage.getItem('stockConfig') || '{}')
    // migrate the old two-value mode ('cylinder' → rotary + round cross-section)
    if (raw.mode === 'cylinder') {
      raw.mode = 'rotary'
      raw.rotaryShape = raw.rotaryShape ?? 'round'
    }
    // square stock used to be a single "across flats" value → a saved square bar
    // keeps its shape when the second dimension appears
    if (raw.side != null && raw.sideH == null) raw.sideH = raw.side
    return { ...DEFAULT_STOCK, ...raw }
  } catch {
    return DEFAULT_STOCK
  }
}

/** The saved Park position (machine coords [X,Y,Z]) or null. The BOARD's G30 is the
 *  durable truth (verified: it survives a power cycle) and is adopted into this cache
 *  on connect; the cache only stands in for a board with nothing stored, because
 *  `G30.1` can write the current position only — the app can never push a value back.
 *  See renderer/src/offsets.ts. */
function loadParkPos(): [number, number, number] | null {
  try {
    const p = JSON.parse(localStorage.getItem('parkPos') || 'null')
    return Array.isArray(p) && p.length >= 2 ? [p[0], p[1], p[2] ?? 0] : null
  } catch {
    return null
  }
}

/** Drive mechanism per axis index, as chosen in the steps calculator. */
function loadAxisMech(): Record<number, string> {
  return loadJson('axisMech', {})
}

/** Read a JSON-shaped localStorage key, falling back when absent or corrupt. */
function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Real (measured) run time per program, keyed by filename — recorded when a job
 *  finishes normally. Lets the next run of the same file show a real time estimate
 *  and count down from it, instead of guessing. */
function loadRunTimes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('runTimes') || '{}')
  } catch {
    return {}
  }
}

/** The active alarm/error the operator still has to deal with. Kept separate
 *  from the transient console `message` so it survives the reset banner and
 *  drives the auto-opening recovery popup. `seq` bumps only on a genuinely new
 *  code, so a repeated error doesn't re-open a popup the user just closed. */
export interface RecoveryAlert {
  kind: 'alarm' | 'error'
  code: number
  seq: number
}

const emptyJob: JobProgress = {
  running: false,
  paused: false,
  total: 0,
  sent: 0,
  elapsedMs: 0,
  etaMs: null
}

/** A pending confirmation request driving the shared <ConfirmDialog>. Text is
 *  passed already-resolved (the caller runs t()), so the dialog stays dumb. */
export interface ConfirmOpts {
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  /** Colour of the confirm button — danger (destructive) or warn. Default danger.
   *  `ask` is neither: a question that destroys nothing should not be dressed as a
   *  warning, or the warnings stop meaning anything. */
  tone?: 'danger' | 'warn' | 'ask'
  /** Show a single-line text field and hand back what was typed — see askText. */
  prompt?: { placeholder?: string }
}

/** The Promise resolver for the open confirm dialog, kept out of the store so
 *  resolving doesn't force an extra render. `askConfirm` sets it; the dialog's
 *  buttons call `resolveConfirm`. */
let confirmResolve: ((r: { ok: boolean; text: string }) => void) | null = null
/** How many housekeeping reads currently want the console quiet — see quietConsole. */
let quietDepth = 0

interface AppState {
  connected: boolean
  /** Active transport kind, so the UI can gate FTP-only features (Ethernet). */
  connKind: TransportKind | null
  status: StatusReport | null
  /** Last known override % [feed, rapid, spindle] — cached because grblHAL only
   *  reports Ov: periodically (snapping to 100 between reports causes flicker). */
  overrides: [number, number, number]
  /** Last known accessory letters (A: field: S/C spindle, F flood, M mist) —
   *  cached because grblHAL only emits A: on change, not every report. */
  accessory: string
  info: MachineInfo
  /** Machine max travel [X,Y,Z] in mm, parsed from $130/$131/$132. Sizes the
   *  visualizer work-area grid. null until a `$$` read has been seen. */
  travel: [number, number, number] | null
  /** WCS offsets (machine coords of each G54–G59 zero) parsed from `$#`, so the
   *  toolpath can draw multi-fixture programs at their real positions. */
  wcsOffsets: Record<string, [number, number, number]>
  /** `[G92:…]` and `[TLO:…]` from the same `$#`. Only the probe uses them, and only
   *  because it writes its result as a machine coordinate (`G10 L2`) and must subtract
   *  what `G10 L20` would have subtracted for it. Both are all-zero on this machine
   *  today; TLO stops being zero as soon as tool lengths are measured. */
  g92Offset: [number, number, number]
  toolOffset: [number, number, number]
  job: JobProgress
  /** Measured run time (ms) per program filename, from the last normal finish.
   *  Persisted → survives restarts, so a program always shows its real time. */
  runTimes: Record<string, number>
  /** Duration (ms) of the job that just finished this session, for the footer's
   *  "finished in X" readout. null until a job completes. */
  lastRunMs: number | null
  /** Job progress 0..1 by DISTANCE covered along the path (set by the Tracker from
   *  the live tool position). Drives the progress bar — a true machined fraction,
   *  not the acked-line count that races ahead of the cut. */
  jobProgress: number
  consoleLines: ConsoleLine[]
  /** The reported position has held still for SETTLE_MS — the machine has stopped.
   *
   *  Measured, not inferred. Anything that soft-resets the controller has to know
   *  this, because a reset while the machine moves loses the position and alarms,
   *  and grblHAL's own sub-state does not answer it: on 1 Aug 2026 `Door:0` — parked
   *  and stationary — was being reported while the fast park to $58 was still under
   *  way. Position is the one thing that cannot be wrong about whether it moved. */
  settled: boolean
  /** Last human-readable alarm/error, shown in the status bar. */
  message: string | null
  /** Active alarm/error needing operator action — drives the footer indicator +
   *  auto-opening recovery popup. Survives the reset banner (unlike `message`). */
  alert: RecoveryAlert | null
  /** Whether the recovery popup is currently shown. */
  recoveryOpen: boolean
  /** A bulk settings write is in progress and owns the wire.
   *
   *  The limits machinery talks to the board on its own — the status handler calls
   *  restoreLimits(), which sends `$21=…` and `$21`. A bulk restore matches replies
   *  to commands by taking the next `ok`, so one injected write shifts every verdict
   *  after it by one: a refusal gets credited to the line before it and a setting
   *  that never landed is reported as written. That is how a restore left soft
   *  limits off on 30 Jul 2026 while reporting nothing refused. */
  bulkWriting: boolean
  /** The guided recovery dialog is open. */
  rescueWizardOpen: boolean
  /** The guided recovery is actually RUNNING — erasing, restarting, writing back.
   *
   *  Distinct from the dialog merely being open, where the operator is still reading
   *  and choosing a backup and any error is genuinely their news. Once it starts, the
   *  errors it provokes are its own: erasing the settings makes the board answer
   *  `error:7` ("a stored setting could not be read"), because that is precisely what
   *  was asked for. The catalogue entry ends "persistent failures point to the storage
   *  chip" — so the app spent 26 s on 2 Aug 2026 hinting at dying hardware to an
   *  operator who had just pressed *erase the settings*. The procedure reports its own
   *  outcome, step by step, and that report is better than anything the footer can say
   *  over the top of it. */
  rescueRunning: boolean
  /** The board is answering `?` but not commands — offer the recovery. Raised by the
   *  detector in App.tsx, cleared the moment the parser answers again. */
  rescueSuggested: boolean
  /** Hold off the automatic reconnect. Set while the operator disconnects on
   *  purpose, and for the length of a flash — the board is *meant* to be gone in
   *  both cases, and a reconnect racing the flash would fight it for the port. */
  noReconnect: boolean
  /** This alarm episode has already been announced (an `ALARM:` line arrived, the
   *  state raised one, or the operator dismissed it). Cleared when the machine
   *  leaves Alarm, so the next one speaks up again — and so the state-derived alert
   *  below cannot re-raise itself on every status report. */
  alarmHandled: boolean
  /** Preference: auto-open the recovery popup on a new alarm/error. Experienced
   *  users can turn this off — the footer notice + "what do I do?" button remain. */
  recoveryPopup: boolean
  /** Hard limits are TEMPORARILY suspended so the operator can drive off a limit
   *  switch (parked on one, every move re-trips the alarm — grbl machines have
   *  always needed this dance). Holds the $21 value to put back. The app restores
   *  it by itself the moment the switch releases; it is never left to the user to
   *  remember, and a machine must not run a program while it is set. */
  limitsSuspended: string | null
  /** A $21 read is in flight: 'suspend' waits for the board's CURRENT value before
   *  clearing bit 0, 'restore' waits for the read-back that proves hard limits are
   *  really back on. Nothing about this feature is done on trust — a cached value
   *  goes stale the moment anything else writes $21, and a `$` write is rejected
   *  outright (error:8) unless the machine is Idle. */
  limitsPending: 'suspend' | 'restore' | null
  limitsPendingAt: number
  /** Escape move queued behind the $21 read — it may only go out once hard limits
   *  are actually off, or it would just re-trip the alarm. */
  escapeJog: { axis: string; dir: 1 | -1 } | null
  /** Every `$n=v` the board has reported this session. Fed by the raw line stream
   *  (a $$ dump, or a single echo), so any feature can read a setting it needs
   *  without a round trip — used to put $21 back byte-for-byte. */
  settingValues: Record<number, string>
  /** A CRITICAL event is active: grblHAL is sitting in its blocking loop and will
   *  refuse everything but a soft reset (and read-only `$` queries) — `$X`/`$H`
   *  come back as error:79. Raised by the controller's own `[MSG:Reset to
   *  continue]` / E-stop / motor-fault messages, cleared by the reset banner.
   *  Hard limit, soft limit, E-stop, motor fault and expander faults do this
   *  (grblHAL `alarm_is_critical`), so Reset is not a suggestion — it is the only
   *  door out, and every other command must be visibly dead until it is taken. */
  resetRequired: boolean
  /** Whether homing is enabled ($22 bit0). Gates the "Home" recovery so we don't
   *  offer $H on a machine that has homing disabled (it would return error:5).
   *  Defaults true until a $$ read reports $22. */
  homingEnabled: boolean
  /** Whether the machine has completed a homing cycle this session (Home→Idle).
   *  Soft limits are only enforced once homed, so continuous jog is clamped to the
   *  remaining travel only when this is true. Cleared on disconnect. */
  homed: boolean
  /** Soft limits enabled ($20). Continuous jog is clamped to travel only when this
   *  AND `homed` are true — exactly when grblHAL would reject an over-travel jog. */
  softLimits: boolean
  /** Homing direction invert mask ($23): bit i set → axis i homes to the negative
   *  end (machine range [0, L]); clear → homes positive (range [-L, 0]). Drives the
   *  continuous-jog travel clamp so the correct direction is allowed. */
  homingDirMask: number
  /** Keyboard/gamepad control preferences (Controls settings). */
  controls: KbControls
  /** User macros (named command sequences), shown in the Macros tab. */
  macros: Macro[]
  /** Touch-plate probe configuration (Settings → Probe). */
  probeConfig: ProbeConfig
  /** Full probing parameters (edge/corner/centre) used by the Probe panel. */
  probeParams: ProbeParams
  /** Stock/material block shown in the 3D view (Settings → Stock). */
  stock: StockConfig
  /** Currently loaded G-code program. */
  gcode: string | null
  /** Software workpiece rotation (degrees, about the work origin) applied to the
   *  program before streaming AND in the visualizer/tracker, so a slightly skewed
   *  clamped part can be cut without re-fixturing. 0 = off. Measured by the Probe
   *  "Angle" mode. Applies to PC-streamed jobs only (SD runs execute on the
   *  controller from the card, which we can't transform on the fly). */
  rotationDeg: number
  filename: string | null
  /** Last SD-card program path (runs on the controller; lets Cycle re-run it). */
  sdFile: string | null
  /** Latched "an SD / external program is running" flag. App-streamed jobs use
   *  `job.running`, but an SD run (`$F=`) executes on the controller with no
   *  progress feedback, so we can't rely on catching the momentary `Run` state
   *  (there's an Idle window right after Cycle, worse over Ethernet, where a jog
   *  could slip in and derail the program). Set true the instant Cycle starts an
   *  SD job; cleared when the machine returns to Idle after executing, on Alarm,
   *  on Stop, or on disconnect. Used — together with `job.running` — to lock out
   *  jog / zeroing / WCS the whole time a program is active. */
  sdRunning: boolean
  /** Library filename backing the current program (PC), so edits save to disk.
   *  null when the program came from SD or hasn't been saved to the library. */
  libFile: string | null
  /** SD-card path the current program was loaded from, so edits save back to the
   *  card. null when the program came from the PC library / a new buffer. */
  sdSource: string | null
  /** Original file line index currently being executed, derived from tool
   *  position (kept in sync with the toolpath arrow). -1 = none. */
  activeLine: number
  /** The file line the controller has ACKED (consumed into its planner). -1 = idle.
   *
   *  Diagnostic only — it does NOT gate the highlight. It usually leads the cut by the
   *  buffer depth, but it can also LAG it: grblHAL answers a G2/G3 once the whole arc is
   *  in the planner, so on a big circle the ack lands near the end of the move. Bounding
   *  the position-based highlight with it froze that highlight for seconds at a time
   *  (arcs_mix.nc, 1 Aug 2026). Where the tool is, is measured — see trackPath.ts. */
  sentLine: number
  /** Line index a "start from line" job begins at, so the tracker seeds the
   *  highlight there instead of line 0. -1 = normal start. */
  resumeLine: number
  /** Park & Resume: `parked` = a job was paused for access (aborted to Idle so the
   *  head can be jogged freely); `parkLine` is the file line to resume from;
   *  `parkProgress` freezes the machined fraction (0..1) at the moment of parking so
   *  the grey "already cut" colouring survives the abort (job.running goes false,
   *  which would otherwise reset jobProgress to 0 and repaint everything cyan). It
   *  also floors the colouring through the resume until the real cut passes it. */
  parked: boolean
  parkLine: number
  parkProgress: number
  /** Saved Park position in MACHINE coords [X,Y,Z], or null if none set. When set (and
   *  the machine is homed) clicking Park retracts Z and rapids the head here (G53)
   *  instead of leaving it for a manual jog. Persisted in the app so it survives a
   *  restart even on grblHAL builds that don't keep G28/G30 across a power cycle. */
  parkPos: [number, number, number] | null

  // UI preferences
  /** Which aux/coolant toggles show in the toolpath overlay (configured in Settings). */
  auxButtons: { vac: boolean; mist: boolean; flood: boolean }
  theme: 'dark' | 'light' | 'softlight' | 'violet'
  /** Effective UI zoom factor (auto-fit to the monitor, or the user's override),
   *  reported by main. Display-only — the persisted override lives in localStorage. */
  zoomFactor: number
  /** Which bottom-left panel tab is active (terminal / g-code preview / macros).
   *  In the store so loading a file / starting a job can auto-focus the preview. */
  bottomTab: 'terminal' | 'gcode' | 'macros'
  /** UI language. English is the default/primary; Serbian for the domestic market. */
  lang: Lang
  units: 'mm' | 'inch'
  posMode: 'work' | 'machine'
  /** Drive mechanism per axis INDEX ('leadscrew' | 'belt' | 'rack' | 'rotary'),
   *  remembered when the steps calculator applies a result to an axis. Tuning uses
   *  it to cap the max-speed slider — a lead screw and a rack are not the same
   *  machine. Unset axes simply get no mechanical cap. */
  axisMech: Record<number, string>
  /** Travel per MOTOR revolution per axis index — mm/rev for a linear axis (a 1605
   *  ball screw direct-coupled = 5), °/rev for a rotary one. Turns a feed rate into
   *  motor rpm, which is what actually predicts a stepper running out of torque. */
  axisPerRev: Record<number, number>
  wcs: string // active work coordinate system, e.g. "G54"
  /** Extra coordinate systems this board reports in `$#` beyond G54–G59 (G59.1–G59.3).
   *  Some grblHAL builds have nine, some six — the DRO only offers the picker when
   *  the controller actually answered with them. Empty until the first `$#` read. */
  extraWcs: string[]
  /** Which G59 variant the last strip button stands for: '' | '.1' | '.2' | '.3'.
   *  A display choice, not a machine state — picking it re-labels the button, and
   *  the button still has to be clicked to activate that system. */
  wcsVariant: string
  settingsOpen: boolean
  /** When Settings is opened via a deep-link, the category to jump to (e.g. 'probe').
   *  SettingsBrowser consumes it on open, then it's cleared. null = no deep-link. */
  settingsSection: string | null
  probeOpen: boolean
  /** Last-used probe measurement type — the Probe window reopens to it (persisted),
   *  so pressing Probe goes straight to the type you use most. */
  /** Last probe type used, remembered across opens. `center` (hole/boss) was one of
   *  these until 31 Jul 2026 and anyone who used it last has it in localStorage —
   *  see loadProbeMode, which lands them on Z rather than on an empty panel. */
  probeMode: 'z' | 'edge' | 'rotate'
  /** Require the tap-to-unlock probe verification before measuring (persisted).
   *  On by default — great safety for beginners. Experienced users can turn it off
   *  in Settings → Probe (the footer already shows the live Probe pin state). */
  probeVerify: boolean
  /** No plate: the tool touches the CONDUCTIVE WORKPIECE itself (persisted).
   *
   *  A metal block is its own touch plate, and a better one — nothing sits between
   *  the tool and the surface, so there is nothing to subtract. Z reads zero at the
   *  top face instead of the plate thickness, and sideways the only thing left
   *  between the contact and the edge is half the tool.
   *
   *  Off by default: it is only correct when the stock conducts AND carries the
   *  probe ground, and getting that wrong on wood means no trigger at all. */
  probeNoPlate: boolean
  fromLineOpen: boolean
  firmwareOpen: boolean
  filesOpen: boolean
  offsetsOpen: boolean
  /** When true, controller lines aren't echoed to the terminal (e.g. during SD dump). */
  suppressLog: boolean
  /** Live input test on the Connections screen: connectors light up as their signal
   *  arrives. Lives here (not in the component) so Diagnostics can switch it on
   *  while deep-linking to that screen. */
  pinTest: boolean
  /** Pending app update (set by the updater); drives the auto-popup notification.
   *  null = up to date. */
  update: UpdateReady | null
  /** Pending confirmation dialog (null = none). Shared across every guarded
   *  action (disconnect mid-job, quit mid-job, flash mid-job, …). */
  confirm: ConfirmOpts | null

  apply: (e: ControllerEvent) => void
  pushConsole: (line: string) => void
  clearConsole: () => void
  clearMessage: () => void
  /** Dismiss the active alarm/error indicator + popup entirely (the footer ✕). */
  clearAlert: () => void
  /** Open/close the recovery popup without dismissing the underlying alert. */
  setRecoveryOpen: (open: boolean) => void
  setNoReconnect: (on: boolean) => void
  setBulkWriting: (on: boolean) => void
  setRescueWizardOpen: (open: boolean) => void
  setRescueRunning: (on: boolean) => void
  setRescueSuggested: (on: boolean) => void
  /** One-tap escape from a limit switch: suspend hard limits, back the axis off by
   *  ESCAPE_MM in the chosen direction, and let the automatic restore re-arm them.
   *  The DIRECTION is the operator's call, never a guess: with MIN and MAX sharing
   *  one input the controller cannot tell which end it sits on, and picking wrong
   *  drives further into the obstacle with the limits off. */
  escapeSwitch: (axis: string, dir: 1 | -1) => void
  /** Temporarily clear $21 bit 0 so the axis can be driven off a limit switch.
   *  Remembers the current value (and mirrors it to localStorage, so a crash or a
   *  pulled cable can't strand the machine with hard limits off). */
  suspendLimits: () => void
  /** Put $21 back exactly as it was. Called automatically once the switch releases. */
  restoreLimits: () => void
  /** Enable/disable auto-opening the recovery popup (persisted). */
  setRecoveryPopup: (on: boolean) => void
  /** Update keyboard/gamepad control preferences (persisted). */
  setControls: (patch: Partial<KbControls>) => void
  /** Restore all control preferences (bindings, mode, feed, step) to defaults. */
  resetControls: () => void
  /** Replace the macro list (persisted). */
  setMacros: (macros: Macro[]) => void
  /** Update touch-plate probe config (merged + persisted). */
  setProbeConfig: (patch: Partial<ProbeConfig>) => void
  setProbeParams: (patch: Partial<ProbeParams>) => void
  /** Update stock config (merged + persisted). */
  setStock: (patch: Partial<StockConfig>) => void
  setFile: (filename: string, gcode: string, libFile?: string | null) => void
  setSdJob: (path: string) => void
  /** Set/clear the latched SD/external-program-running flag (Cycle sets it). */
  setSdRunning: (v: boolean) => void
  setLibFile: (name: string | null) => void
  setSdSource: (name: string | null) => void
  /** Replace the program text in place, keeping the current backing source. */
  updateGcode: (gcode: string) => void
  /** Set the software workpiece-rotation angle (degrees, 0 = off). */
  setRotationDeg: (deg: number) => void
  clearFile: () => void
  setAuxButton: (key: 'vac' | 'mist' | 'flood', on: boolean) => void
  setTheme: (t: 'dark' | 'light' | 'softlight' | 'violet') => void
  setZoomFactor: (v: number) => void
  setBottomTab: (t: 'terminal' | 'gcode' | 'macros') => void
  setLang: (l: Lang) => void
  setUnits: (u: 'mm' | 'inch') => void
  setPosMode: (m: 'work' | 'machine') => void
  setAxisMech: (axisIndex: number, mech: string) => void
  setAxisPerRev: (axisIndex: number, perRev: number) => void
  setWcs: (w: string) => void
  setExtraWcs: (list: string[]) => void
  setWcsVariant: (v: string) => void
  setSettingsOpen: (open: boolean) => void
  /** Open Settings jumped straight to a category (deep-link). */
  openSettingsAt: (section: string) => void
  /** Clear the pending deep-link once SettingsBrowser has consumed it. */
  clearSettingsSection: () => void
  setProbeOpen: (open: boolean) => void
  setProbeMode: (mode: 'z' | 'edge' | 'rotate') => void
  setProbeVerify: (on: boolean) => void
  setProbeNoPlate: (on: boolean) => void
  setFromLineOpen: (open: boolean) => void
  setFirmwareOpen: (open: boolean) => void
  setFilesOpen: (open: boolean) => void
  setOffsetsOpen: (open: boolean) => void
  setSuppressLog: (v: boolean) => void
  /** Hold the console quiet while housekeeping streams — NESTABLE, unlike the flag
   *  above, and that is the whole point of it existing.
   *
   *  Two readers run at once on every connect: `$#` for the offsets and `$$` for the
   *  settings. Each used to set and clear the flag itself, so whichever finished first
   *  unquietened the console while the other was still streaming — and the one still
   *  streaming is the 116-line one. Each caller now says only when its own quiet
   *  begins and ends; the console stays down until the last of them is done. */
  quietConsole: (on: boolean) => void
  /** Begin the live input test: hard limits are suspended for its duration, so a
   *  switch pressed on purpose reports its state without alarming the machine. */
  startPinTest: () => void
  /** End it: re-arm hard limits and offer to clear an alarm the test provoked
   *  (E-stop always alarms — no setting can stop that one). */
  stopPinTest: () => Promise<void>
  setUpdate: (u: UpdateReady | null) => void
  /** Show a confirmation dialog and resolve true (confirmed) / false (cancelled). */
  askConfirm: (opts: ConfirmOpts) => Promise<boolean>
  /** Same dialog with a text field: resolves what was typed, or null if cancelled.
   *  An empty string is an answer, not a cancellation. */
  askText: (opts: Omit<ConfirmOpts, 'prompt'> & { placeholder?: string }) => Promise<string | null>
  /** Resolve the open confirm dialog (wired to its buttons). */
  resolveConfirm: (ok: boolean, text?: string) => void
  setActiveLine: (n: number) => void
  setJobProgress: (v: number) => void
  setResumeLine: (n: number) => void
  setParked: (v: boolean) => void
  setParkLine: (n: number) => void
  setParkProgress: (v: number) => void
  setParkPos: (p: [number, number, number] | null) => void
}

export const useStore = create<AppState>((set, get) => ({
  connected: false,
  connKind: null,
  status: null,
  overrides: [100, 100, 100],
  accessory: '',
  info: EMPTY_INFO,
  travel: null,
  wcsOffsets: {},
  g92Offset: [0, 0, 0],
  toolOffset: [0, 0, 0],
  job: emptyJob,
  runTimes: loadRunTimes(),
  lastRunMs: null,
  jobProgress: 0,
  consoleLines: [],
  settled: false,
  message: null,
  alert: null,
  recoveryOpen: false,
  bulkWriting: false,
  rescueWizardOpen: false,
  rescueRunning: false,
  rescueSuggested: false,
  noReconnect: false,
  alarmHandled: false,
  recoveryPopup: localStorage.getItem('recoveryPopup') !== '0',
  limitsSuspended: null,
  limitsPending: null,
  limitsPendingAt: 0,
  escapeJog: null,
  settingValues: {},
  resetRequired: false,
  homingEnabled: true,
  homed: false,
  softLimits: false,
  homingDirMask: 0,
  controls: loadControls(),
  macros: loadMacros(),
  probeConfig: loadProbe(),
  probeParams: loadProbeParams(),
  stock: loadStock(),
  gcode: null,
  rotationDeg: Number(localStorage.getItem('rotationDeg')) || 0,
  filename: null,
  sdFile: null,
  sdRunning: false,
  libFile: null,
  sdSource: null,
  activeLine: -1,
  sentLine: -1,
  resumeLine: -1,
  parked: false,
  parkLine: -1,
  parkProgress: 0,
  parkPos: loadParkPos(),
  auxButtons: loadAux(),
  theme: (localStorage.getItem('theme') as 'dark' | 'light' | 'softlight' | 'violet') || 'dark',
  zoomFactor: 1,
  bottomTab: 'terminal',
  lang: (localStorage.getItem('lang') as Lang) || 'en',
  units: (localStorage.getItem('units') as 'mm' | 'inch') || 'mm',
  posMode: (localStorage.getItem('posMode') as 'work' | 'machine') || 'work',
  axisMech: loadAxisMech(),
  axisPerRev: loadJson<Record<number, number>>('axisPerRev', {}),
  wcs: 'G54',
  extraWcs: [],
  wcsVariant: localStorage.getItem('wcsVariant') || '',
  settingsOpen: false,
  settingsSection: null,
  probeOpen: false,
  probeMode: loadProbeMode(),
  probeVerify: localStorage.getItem('probeVerify') !== '0',
  probeNoPlate: localStorage.getItem('probeNoPlate') === '1',
  fromLineOpen: false,
  firmwareOpen: false,
  filesOpen: false,
  offsetsOpen: false,
  suppressLog: false,
  pinTest: false,
  update: null,
  confirm: null,

  apply: (e) =>
    set((s) => {
      switch (e.type) {
        case 'connected':
          // a new board has proved nothing yet, whatever the last one did
          parserAliveAt = 0
          return {
            connected: true,
            connKind: e.data.kind,
            // the board on the other end may not be the one we last spoke to —
            // a different firmware, a different machine — so forget what we knew
            // and let this connection's own $I say who it is
            info: EMPTY_INFO,
            // A crash / pulled cable mid-suspend left the board with hard limits
            // off. Pick the pending restore back up so the warning is visible and
            // the first clear status report re-arms them.
            limitsSuspended: localStorage.getItem('limitsSuspended'),
            limitsPending: null,
            // Re-arm the automatic reconnect. Whatever the board was deliberately
            // taken away for — a manual disconnect, a flash — is over the moment we
            // are talking to it again, and this is the one place that is true of
            // every route back in.
            noReconnect: false,
            consoleLines: cap(s.consoleLines, t('store.connected', s.lang, { kind: e.data.kind }))
          }
        case 'disconnected':
          return {
            connected: false,
            connKind: null,
            status: null,
            job: emptyJob,
            sdRunning: false,
            homed: false,
            activeLine: -1,
            sentLine: -1,
            alert: null,
            recoveryOpen: false,
            // a machine we meet again is a fresh episode — announce whatever it is
            // sitting in, even if we had already been told about it last time
            alarmHandled: false,
            resetRequired: false,
            // no board to write to; localStorage keeps the pending restore
            limitsSuspended: null,
            limitsPending: null,
            consoleLines: cap(
              s.consoleLines,
              e.data.reason
                ? t('store.disconnectedReason', s.lang, { reason: e.data.reason })
                : t('store.disconnected', s.lang)
            )
          }
        case 'status': {
          // Has the machine actually stopped? Measured from the reported position,
          // not inferred from the state: on 1 Aug the Door sub-state read 0 ("parked,
          // stationary") while the fast park to $58 was still running, and anything
          // that soft-resets on that answer alarms. Position cannot lie about it.
          const posKey = (e.data.mpos ?? e.data.wpos ?? []).join(',')
          if (posKey !== lastPosKey) {
            lastPosKey = posKey
            lastMoveAt = Date.now()
          }
          const settled = Date.now() - lastMoveAt >= SETTLE_MS
          // auto-clear a shown error/alarm once the machine leaves the Alarm state
          const prevBase = (s.status?.state ?? '').split(':')[0]
          const newBase = e.data.state.split(':')[0]
          const cleared = prevBase === 'Alarm' && newBase !== 'Alarm'
          // Clear the latched SD-running flag once the program is truly over:
          // an executing→idle transition (Run/Hold/…→Idle), or an Alarm. We only
          // clear on a transition *out of* an executing state so the Idle window
          // right after Cycle (before the machine reaches Run) doesn't clear it.
          const EXEC = ['Run', 'Hold', 'Door', 'Home', 'Jog']
          const sdPatch =
            s.sdRunning && (newBase === 'Alarm' || (EXEC.includes(prevBase) && !EXEC.includes(newBase)))
              ? { sdRunning: false }
              : {}
          // The controller's own |H: field wins whenever it is present — it is the
          // only thing that knows the reference was DROPPED (grblHAL clears it on a
          // reset that lost position, $676 bit 0). Falling back to the Home → Idle
          // transition alone would leave the app believing a machine is referenced
          // long after an E-stop took that away.
          const homedPatch =
            e.data.homed != null
              ? e.data.homed !== s.homed
                ? { homed: e.data.homed }
                : {}
              : prevBase === 'Home' && newBase === 'Idle' && !s.homed
                ? { homed: true }
                : {}
          // the homed truth AFTER this report — what the popup rule below must use
          const homedNow =
            e.data.homed ?? (prevBase === 'Home' && newBase === 'Idle' ? true : s.homed)
          // leaving Alarm means the operator recovered → drop the alert + popup,
          // UNLESS a Home step is still pending (homing on + this code recommends
          // $H): keep the popup so Home lights up as the guided second step.
          let recoveryPatch: Partial<AppState> = {}
          if (cleared) {
            const det = s.alert
              ? s.alert.kind === 'alarm'
                ? getAlarm(s.alert.code)
                : getError(s.alert.code)
              : null
            // …but only if homing is genuinely still owed: a machine that kept its
            // reference through the alarm has nothing left to do, and holding the
            // popup open just to say "recovered" is one more window to dismiss.
            const homePending =
              !!det && s.homingEnabled && !homedNow && (det.actions ?? []).includes('home')
            recoveryPatch = homePending ? {} : { message: null, alert: null, recoveryOpen: false }
          }
          // out of Alarm ⇒ the blocking loop is behind us, whatever we saw last
          const criticalPatch = s.resetRequired && newBase !== 'Alarm' ? { resetRequired: false } : {}

          // An alarm the app never HEARD. Connect to a machine that is already in
          // alarm — the app started with the E-stop down, or was closed while the
          // machine sat latched — and the `ALARM:n` line was emitted long before
          // anything was listening. All that is left is the state, so the whole
          // guided recovery used to stay silent exactly when a newcomer needs it,
          // leaving a red word in the top bar and no way to learn what to press.
          //
          // The code comes from whatever is available, in order of certainty:
          // `Alarm:10` if the board appends the substate ($10 bit 10), otherwise
          // what the asserted inputs prove (E-stop, a limit switch), otherwise 0 —
          // our stand-in whose procedure is the universal one (see messages.ts).
          let stateAlarmPatch: Partial<AppState> = {}
          if (newBase === 'Alarm' && !s.alarmHandled && !s.alert) {
            const sub = Number(e.data.state.split(':')[1])
            const pins = e.data.pins ?? ''
            const code = Number.isFinite(sub) && sub > 0 ? sub : pins.includes('E') ? 10 : hasLimitPin(pins) ? 1 : 0
            stateAlarmPatch = {
              // seq 1: this branch only runs when there is no alert to count from,
              // and every consumer keys on the value CHANGING, not on its size
              alert: { kind: 'alarm', code, seq: 1 },
              alarmHandled: true,
              recoveryOpen: s.recoveryPopup && !s.pinTest
            }
          } else if (newBase !== 'Alarm' && s.alarmHandled) {
            stateAlarmPatch = { alarmHandled: false } // episode over; the next one speaks up
          }
          // The switch has released (no limit letters left in Pn:) → put hard limits
          // back. This is the whole safety of the suspend feature: the machine is
          // unguarded only for the few seconds it takes to drive clear, and getting
          // clear is itself the signal to re-arm. Fired from here (not once, on an
          // event) so it RETRIES: the write needs Idle, and the jog that frees the
          // switch is not Idle. A stalled read-back is retried after 1.5 s too, so a
          // dropped line can never leave the warning stuck — or the limits off.
          // …except during the input test, where the limits are suspended ON PURPOSE
          // for as long as it runs. Without this exception the first released switch
          // would re-arm them and the next press would alarm — the exact noise the
          // test exists to avoid. stopPinTest() restores them.
          if (s.limitsSuspended != null && !s.pinTest && !s.bulkWriting && !hasLimitPin(e.data.pins) && Date.now() - s.limitsPendingAt > 1500)
            get().restoreLimits()
          return {
            status: e.data,
            ...(settled !== s.settled ? { settled } : {}),
            ...(e.data.ov ? { overrides: e.data.ov } : {}),
            // A: only present on change → cache it; absent means "unchanged"
            ...(e.data.accessory != null ? { accessory: e.data.accessory } : {}),
            ...sdPatch,
            ...homedPatch,
            ...recoveryPatch,
            ...criticalPatch,
            ...stateAlarmPatch
          }
        }
        case 'info':
          return { info: e.data }
        case 'job': {
          // a finished/stopped job clears the highlight + progress bound. The frozen
          // park colouring (parkProgress) is kept while `parked` (the abort behind a
          // Park must NOT wipe the grey); a genuine finish/stop clears it back to 0.
          const jobPatch = e.data.running
            ? // a fresh start clears the previous "finished in X" readout
              !s.job.running
              ? { lastRunMs: null }
              : {}
            : { activeLine: -1, sentLine: -1, ...(s.parked ? {} : { parkProgress: 0 }) }
          // normal completion → remember this program's REAL run time (keyed by
          // filename) so the next run shows a real estimate and counts down from it
          if (e.data.done && e.data.elapsedMs > 0) {
            const runTimes = s.filename
              ? { ...s.runTimes, [s.filename]: e.data.elapsedMs }
              : s.runTimes
            if (s.filename) localStorage.setItem('runTimes', JSON.stringify(runTimes))
            return { job: e.data, ...jobPatch, runTimes, lastRunMs: e.data.elapsedMs }
          }
          return { job: e.data, ...jobPatch }
        }
        case 'active':
          // ack-based progress bound (leads the cut); the Tracker turns tool
          // position + this bound into the synced highlight line
          return s.sentLine === e.data ? {} : { sentLine: e.data }
        case 'sent': {
          // A setting WE write is never echoed back by grblHAL (just `ok`), so the
          // cache has to learn from the outgoing line too — otherwise it keeps
          // serving whatever the last $$ dump said, forever.
          const mw = /^\$(\d+)=(.+)$/.exec(e.data.trim())
          return {
            consoleLines: cap(s.consoleLines, `> ${e.data}`),
            ...(mw ? { settingValues: { ...s.settingValues, [Number(mw[1])]: mw[2].trim() } } : {})
          }
        }
        case 'line': {
          // An `ok` or an `error:` is the line parser answering — the one thing that
          // proves it is running, and the thing the guided recovery exists to decide
          // about. Kept out of the store on purpose: during a job these arrive twenty
          // times a second and nothing renders off them.
          if (e.data === 'ok' || /^error:/i.test(e.data)) parserAliveAt = Date.now()
          const msg = describe(e.data, s.lang)
          const gc = parseParserState(e.data)
          // any `$n=v` the board reports → the session-wide settings cache
          const mSet = /^\$(\d+)=(.*)$/.exec(e.data.trim())
          // …and a $21 report closes whichever half of the suspend dance is open.
          // The board's own word is the only thing that moves this state: on
          // 'suspend' it is the value we must give back later, on 'restore' it is
          // the proof hard limits are on again. A restore that reads back with
          // bit 0 clear leaves the warning up rather than pretending it worked.
          const m21 = mSet && Number(mSet[1]) === 21 ? mSet[2].trim() : null
          let limitsPatch: Partial<AppState> = {}
          if (m21 != null && s.limitsPending === 'suspend') {
            localStorage.setItem('limitsSuspended', m21)
            window.recta.send('$21=0')
            // the queued escape move goes out behind the write, in wire order, so
            // it can no longer race the hard limit it is escaping from
            if (s.escapeJog) window.recta.send(escapeJogLine(s.escapeJog.axis, s.escapeJog.dir))
            limitsPatch = { limitsSuspended: m21, limitsPending: null, escapeJog: null }
          } else if (m21 != null && s.limitsPending === 'restore') {
            if (Number(m21) & 1) {
              localStorage.removeItem('limitsSuspended')
              limitsPatch = { limitsSuspended: null, limitsPending: null }
            } else limitsPatch = { limitsPending: null } // still off → keep warning, retry
          }
          // units are owned by $13 (report inches) — sync whenever it's reported
          const m13 = /^\$13=(\d+)/.exec(e.data.trim())
          // max travel $130/$131/$132 → sizes the visualizer grid
          const mT = /^\$(130|131|132)=([\d.]+)/.exec(e.data.trim())
          // $22 homing enable (bit0) → gate the "Home" recovery so we never
          // suggest $H on a machine where homing is disabled (it returns error:5)
          const m22 = /^\$22=(\d+)/.exec(e.data.trim())
          // $20 soft-limits enable + $23 homing-direction mask → drive the
          // continuous-jog travel clamp (only meaningful once homed).
          const m20 = /^\$20=(\d+)/.exec(e.data.trim())
          const m23 = /^\$23=(\d+)/.exec(e.data.trim())
          // WCS offset report [G54:x,y,z,…] → positions multi-fixture toolpaths
          const mW = /^\[(G5[4-9]):([-\d.,]+)/.exec(e.data.trim())
          // The two MODIFIERS that sit on top of the coordinate system, from the same
          // `$#` reply. Kept because a probe that writes its result as a machine
          // coordinate (G10 L2) has to subtract them by hand: the board's own G10 L20
          // does it internally — `WCS = MPos - G92 - TLO - WPos` (gcode.c) — and a
          // replacement that skipped the term would be exact only while both are zero,
          // which is today and stops being true the moment tool length offsets are used.
          const mG92 = /^\[G92:([-\d.,]+)/.exec(e.data.trim())
          const mTLO = /^\[TLO:([-\d.,]+)/.exec(e.data.trim())
          // a reset/welcome banner means the controller restarted → clear the
          // transient console `message`. The persistent `alert` (below) is NOT
          // touched here — it survives the banner and is cleared only when the
          // machine actually recovers (leaves Alarm) or the user dismisses it.
          const banner = /grbl/i.test(e.data) || e.data.includes('for help')
          // grblHAL announces a CRITICAL event with one of these, then blocks
          // everything but a soft reset (see `resetRequired`). The banner above is
          // the proof the reset landed, so it lifts the flag.
          // covers "Reset to continue" (hard/soft limit, expander) plus the E-stop
          // and motor-fault wordings, which both end in "…then reset to continue"
          const critical = /reset to continue/i.test(e.data)
          const resetPatch = critical
            ? { resetRequired: true }
            : banner && s.resetRequired
              ? { resetRequired: false }
              : {}
          // an alarm/error that needs operator action → raise (or refresh) the
          // alert. `seq` bumps only on a genuinely new code. A new code auto-opens
          // the recovery popup, but ONLY for alarms or errors hit during a job —
          // an idle MDI typo just shows in the footer, no popup in your face.
          const parsed = parseCode(e.data, s.lang)
          // An ALARM outranks any error it drags behind it. A tripped limit mid-job
          // answers error:9 to every line still draining out of the controller's
          // buffer, and error:79 to a too-early $X — all of it is the alarm's own
          // wake. Letting those become the alert would swap the real problem for
          // its echo AND swap in a shorter procedure (that is how the popup came to
          // vanish after Unlock, with the machine still sitting on the switch).
          // They stay visible in the console and the footer; they just do not take
          // the stage while the alarm still stands.
          // A refusal inside a bulk settings write is the same kind of thing: not a
          // fault of the machine but a step of a routine that has its own verdict. A
          // dump is written in numeric order while `$20` (soft limits) is refused
          // until `$22` (homing) is on several lines later, so error:10 is the NORMAL
          // path through a restore, and the second pass fixes it seconds later. Left
          // to become the alert it put "error:10 — Soft limits need homing" and a
          // "What do I do?" button in the status bar underneath a recovery dialog
          // reading "Done. 115 settings written back" — seen on 2 Aug 2026, on a
          // board whose $20 had been correct for forty seconds by then. That is the
          // worst possible moment to be told something is wrong: the operator has
          // just had their settings erased and is trusting the procedure to put them
          // back. What actually failed is reported by the restore itself, read back
          // from the board rather than inferred from replies — a better answer than
          // this one could ever be. The line still prints in the console.
          //
          // Alarms are NOT included: an E-stop during a restore is real, is the
          // operator's business immediately, and has nothing to do with the writing.
          const alarmState = (s.status?.state ?? '').split(':')[0] === 'Alarm'
          // OURS: an error a routine of ours provoked, rather than one the machine
          // volunteered. Kept apart from the alarm case below because the two want
          // different things from the footer — an alarm's wake stays written there
          // (it is true, and the operator is dealing with the alarm anyway), while
          // this must leave no mark at all. The footer draws from two places and
          // suppressing only the alert was half a fix: the transient message still
          // flashed "error:10 — Soft limits need homing" and then cleared itself,
          // which is arguably worse than leaving it up — a red line nobody can read
          // twice is a thing you cannot check afterwards.
          const ours = parsed?.kind === 'error' && (s.bulkWriting || s.rescueRunning)
          const echo =
            parsed?.kind === 'error' &&
            ((s.alert?.kind === 'alarm' && (alarmState || s.resetRequired || critical)) ||
              (parsed.detail.code === 79 && (s.resetRequired || critical)) ||
              ours)
          const recover =
            parsed && !echo && (parsed.detail.cause || parsed.detail.recovery) ? parsed : null
          const sameAlert =
            recover != null &&
            s.alert != null &&
            s.alert.kind === recover.kind &&
            s.alert.code === recover.detail.code
          // A repeated ALARM is a NEW event, not a duplicate: the controller emits
          // it once per trip, so hitting the same limit again — or dismissing the
          // popup and triggering the same alarm a second time — must raise it again.
          // Errors keep the suppression: a bad program can flood the same code.
          const reRaise = sameAlert && recover!.kind === 'alarm'
          // …but not over the input test: an alarm raised there was raised on
          // purpose, and a modal covering the board picture is exactly what the
          // operator is trying to look at. The footer indicator and the status bar
          // still say it happened — only the popup stands down.
          const autoOpen =
            recover != null &&
            s.recoveryPopup &&
            !s.pinTest &&
            (recover.kind === 'alarm' || s.job.running)
          const alertPatch =
            recover && (!sameAlert || reRaise)
              ? {
                  alert: { kind: recover.kind, code: recover.detail.code, seq: (s.alert?.seq ?? 0) + 1 },
                  recoveryOpen: autoOpen || s.recoveryOpen,
                  // heard live, so the state-derived alert must not raise it again
                  ...(recover.kind === 'alarm' ? { alarmHandled: true } : {})
                }
              : {}
          const extra = {
            ...alertPatch,
            ...resetPatch,
            ...limitsPatch,
            // `ours` keeps the footer clean; the line still reaches the console below
            ...(banner ? { message: null } : msg && !ours ? { message: msg } : {}),
            ...(gc.wcs ? { wcs: gc.wcs } : {}),
            ...(mSet
              ? { settingValues: { ...s.settingValues, [Number(mSet[1])]: mSet[2].trim() } }
              : {}),
            ...(m13 ? { units: (m13[1] === '1' ? 'inch' : 'mm') as 'mm' | 'inch' } : {}),
            ...(m22 ? { homingEnabled: (Number(m22[1]) & 1) === 1 } : {}),
            ...(m20 ? { softLimits: Number(m20[1]) !== 0 } : {}),
            ...(m23 ? { homingDirMask: Number(m23[1]) } : {}),
            ...(mT ? { travel: withTravel(s.travel, Number(mT[1]) - 130, Number(mT[2])) } : {}),
            ...(mW ? { wcsOffsets: { ...s.wcsOffsets, [mW[1]]: firstThree(mW[2]) } } : {}),
            ...(mG92 ? { g92Offset: firstThree(mG92[1]) } : {}),
            ...(mTLO ? { toolOffset: firstThree(mTLO[1]) } : {})
          }
          // during SD dump etc. don't flood the terminal with raw lines
          if (s.suppressLog) return extra
          // while streaming, a bare `ok` is just flow-control noise (one per line
          // → 100k+ on a real program): keep it working internally but don't echo
          // it. MDI `ok` (job idle) still shows, so manual commands stay confirmed.
          if (s.job.running && e.data.trim() === 'ok') return extra
          return { consoleLines: cap(s.consoleLines, `< ${e.data}`), ...extra }
        }
        case 'error':
          return { consoleLines: cap(s.consoleLines, `! ${e.data}`), message: e.data }
        default:
          return {}
      }
    }),

  pushConsole: (line) => set((s) => ({ consoleLines: cap(s.consoleLines, line) })),
  clearConsole: () => set({ consoleLines: [] }),
  clearMessage: () => set({ message: null }),
  // Dismissing counts as handled: the machine may well still be in Alarm, and the
  // state-derived alert would otherwise put the popup straight back on screen.
  clearAlert: () => set({ alert: null, message: null, recoveryOpen: false, alarmHandled: true }),
  setRecoveryOpen: (open) => set({ recoveryOpen: open }),
  setNoReconnect: (on) => set({ noReconnect: on }),
  setBulkWriting: (on) => set({ bulkWriting: on }),
  setRescueWizardOpen: (open) => set({ rescueWizardOpen: open }),
  setRescueRunning: (on) => set({ rescueRunning: on }),
  setRescueSuggested: (on) => set({ rescueSuggested: on }),
  escapeSwitch: (axis, dir) => {
    const s = get()
    // strictly Idle: a jog is refused in Alarm, and mid-move it would queue up
    if ((s.status?.state ?? '').split(':')[0] !== 'Idle') return
    // already unguarded (a repeat press, switch still not free) → just move again
    if (s.limitsSuspended != null) window.recta.send(escapeJogLine(axis, dir))
    else {
      set({ escapeJog: { axis, dir } }) // released by the $21 reply, once limits are off
      get().suspendLimits()
    }
  },
  suspendLimits: () => {
    const s = get()
    // a reply that never came (busy board, dropped line) must not wedge the button
    if (s.limitsSuspended != null || (s.limitsPending && Date.now() - s.limitsPendingAt < 1500))
      return
    if (s.bulkWriting) return // a restore owns the wire — see bulkWriting
    if (!settingsWritable(s.status?.state)) return
    // Read $21 off the board first. Whatever we think we know can be stale — the
    // Settings page writes $21 without the board echoing it back — and saving a
    // wrong value here is what would strand the machine with hard limits off.
    // The reply drives the actual `$21=0` (see the '21' branch in 'line').
    window.recta.send('$21')
    set({ limitsPending: 'suspend', limitsPendingAt: Date.now() })
  },
  restoreLimits: () => {
    const s = get()
    const saved = s.limitsSuspended ?? localStorage.getItem('limitsSuspended')
    if (saved == null) return
    if (s.bulkWriting) return // a restore owns the wire — see bulkWriting
    // A `$` write outside Idle answers error:8 and changes nothing; the status
    // handler calls this again on the next report, so waiting costs nothing.
    if (!settingsWritable(s.status?.state)) return
    // Bit 0 is forced back ON: a restore that leaves hard limits off is not a
    // restore. (NaN|1 === 1, so even a garbage saved value lands on "enabled".)
    window.recta.send(`$21=${Number(saved) | 1}`)
    window.recta.send('$21') // …and read it back — the reply is what clears the warning
    set({ limitsPending: 'restore', limitsPendingAt: Date.now(), limitsSuspended: saved })
  },
  setRecoveryPopup: (on) => {
    localStorage.setItem('recoveryPopup', on ? '1' : '0')
    set({ recoveryPopup: on })
  },
  setControls: (patch) =>
    set((s) => {
      const controls = { ...s.controls, ...patch }
      localStorage.setItem('controls', JSON.stringify(controls))
      return { controls }
    }),
  resetControls: () => {
    const controls: KbControls = { ...DEFAULT_CONTROLS, bindings: { ...DEFAULT_BINDINGS } }
    localStorage.setItem('controls', JSON.stringify(controls))
    set({ controls })
  },
  setMacros: (macros) => {
    localStorage.setItem('macros', JSON.stringify(macros))
    set({ macros })
  },
  setProbeConfig: (patch) =>
    set((s) => {
      const probeConfig = { ...s.probeConfig, ...patch }
      localStorage.setItem('probeConfig', JSON.stringify(probeConfig))
      return { probeConfig }
    }),
  setProbeParams: (patch) =>
    set((s) => {
      const probeParams = { ...s.probeParams, ...patch }
      localStorage.setItem('probeParams', JSON.stringify(probeParams))
      return { probeParams }
    }),
  setStock: (patch) =>
    set((s) => {
      const stock = { ...s.stock, ...patch }
      localStorage.setItem('stockConfig', JSON.stringify(stock))
      return { stock }
    }),
  setFile: (filename, gcode, libFile = null) =>
    set((s) => ({
      filename,
      gcode,
      sdFile: null,
      libFile,
      sdSource: null,
      bottomTab: 'gcode', // auto-focus the g-code preview when a program is loaded
      parked: false, // a fresh program clears any pending park/resume
      parkProgress: 0, // …and any frozen grey "already cut" colouring
      lastRunMs: null, // drop the previous program's "finished in X" readout
      consoleLines: cap(
        s.consoleLines,
        t('store.loaded', s.lang, {
          file: filename,
          n: gcode.split(/\r?\n/).filter((l) => l.trim()).length,
          time: new Date().toLocaleTimeString()
        })
      )
    })),
  setSdJob: (path) => set({ sdFile: path, filename: path, gcode: null }),
  setSdRunning: (sdRunning) => set({ sdRunning }),
  setLibFile: (libFile) => set({ libFile }),
  setSdSource: (sdSource) => set({ sdSource }),
  updateGcode: (gcode) => set({ gcode }),
  setRotationDeg: (deg) => {
    localStorage.setItem('rotationDeg', String(deg))
    set({ rotationDeg: deg })
  },
  clearFile: () =>
    set({
      filename: null,
      gcode: null,
      sdFile: null,
      libFile: null,
      sdSource: null,
      lastRunMs: null,
      parked: false,
      parkProgress: 0
    }),
  setAuxButton: (key, on) =>
    set((s) => {
      const auxButtons = { ...s.auxButtons, [key]: on }
      localStorage.setItem('auxButtons', JSON.stringify(auxButtons))
      return { auxButtons }
    }),
  setTheme: (theme) => {
    localStorage.setItem('theme', theme)
    set({ theme })
  },
  setZoomFactor: (zoomFactor) => set((s) => (s.zoomFactor === zoomFactor ? {} : { zoomFactor })),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setLang: (lang) => {
    localStorage.setItem('lang', lang)
    set({ lang })
  },
  setUnits: (units) => {
    localStorage.setItem('units', units)
    set({ units })
  },
  setPosMode: (posMode) => {
    localStorage.setItem('posMode', posMode)
    set({ posMode })
  },
  setAxisMech: (axisIndex, mech) =>
    set((s) => {
      const axisMech = { ...s.axisMech, [axisIndex]: mech }
      localStorage.setItem('axisMech', JSON.stringify(axisMech))
      return { axisMech }
    }),
  setAxisPerRev: (axisIndex, perRev) =>
    set((s) => {
      const axisPerRev = { ...s.axisPerRev, [axisIndex]: perRev }
      localStorage.setItem('axisPerRev', JSON.stringify(axisPerRev))
      return { axisPerRev }
    }),
  setWcs: (wcs) => set({ wcs }),
  setExtraWcs: (extraWcs) => set({ extraWcs }),
  setWcsVariant: (wcsVariant) => {
    localStorage.setItem('wcsVariant', wcsVariant)
    set({ wcsVariant })
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  openSettingsAt: (section) => set({ settingsOpen: true, settingsSection: section, probeOpen: false }),
  clearSettingsSection: () => set({ settingsSection: null }),
  setProbeOpen: (probeOpen) => set({ probeOpen }),
  setProbeMode: (probeMode) => {
    localStorage.setItem('probeMode', probeMode)
    set({ probeMode })
  },
  setProbeVerify: (on) => {
    localStorage.setItem('probeVerify', on ? '1' : '0')
    set({ probeVerify: on })
  },
  setProbeNoPlate: (on) => {
    localStorage.setItem('probeNoPlate', on ? '1' : '0')
    set({ probeNoPlate: on })
  },
  setFromLineOpen: (fromLineOpen) => set({ fromLineOpen }),
  setFirmwareOpen: (firmwareOpen) => set({ firmwareOpen }),
  setFilesOpen: (filesOpen) => set({ filesOpen }),
  setOffsetsOpen: (offsetsOpen) => set({ offsetsOpen }),
  setSuppressLog: (suppressLog) => set({ suppressLog }),
  quietConsole: (on) => {
    quietDepth = Math.max(0, quietDepth + (on ? 1 : -1))
    set({ suppressLog: quietDepth > 0 })
  },
  startPinTest: () => {
    // Pressing a limit switch on a machine with hard limits armed raises ALARM:1 —
    // which is right when it happens by accident and pure noise when the operator
    // is deliberately checking the wiring. Suspending $21 keeps the switch state in
    // `Pn:` (what the test reads) while the machine stops treating it as a crash.
    // Everything that makes the suspend safe comes along: the warning banner, the
    // refusal to start a program, and the localStorage record that survives a crash.
    set({ pinTest: true })
    get().suspendLimits()
    void window.recta.logWrite('ui', 'input test started — hard limits suspended for its duration')
  },
  stopPinTest: async () => {
    set({ pinTest: false })
    void window.recta.logWrite('ui', 'input test ended')
    const base = (get().status?.state ?? '').split(':')[0]
    // An E-stop (or a motor fault) alarms whatever $21 says, so the test can end
    // with the machine latched. Offer to clear it rather than leaving the operator
    // in an alarm they were told to cause — but ask, because clearing means a soft
    // reset and that is never done behind someone's back.
    if (base === 'Alarm') {
      const ok = await get().askConfirm({
        title: t('ui.pinTest.clearTitle', get().lang),
        body: t('ui.pinTest.clearBody', get().lang),
        confirmLabel: t('ui.pinTest.clearBtn', get().lang),
        cancelLabel: t('ui.pinTest.keepBtn', get().lang),
        tone: 'warn'
      })
      // Reset first, unlock after: a hard limit / E-stop / motor fault holds the
      // controller in its blocking loop, where `$X` alone answers error:79.
      if (ok) {
        window.recta.realtime(0x18)
        setTimeout(() => window.recta.send('$X'), 600)
      }
    }
    // Re-arm. A `$` write needs Idle, so this may be refused right now — the status
    // handler retries on every report once the test flag is down, and the warning
    // stays up until the board reads back with bit 0 set.
    get().restoreLimits()
  },
  setUpdate: (update) => set({ update }),
  askConfirm: (opts) =>
    new Promise<boolean>((resolve) => {
      // if one is already open, cancel it first so its promise never dangles
      confirmResolve?.({ ok: false, text: '' })
      confirmResolve = (r) => resolve(r.ok)
      set({ confirm: opts })
    }),
  askText: (opts) =>
    new Promise<string | null>((resolve) => {
      confirmResolve?.({ ok: false, text: '' })
      // null for cancelled, the string for confirmed — INCLUDING the empty one, which
      // is a real answer ("no name, the date will do") and not a refusal
      confirmResolve = (r) => resolve(r.ok ? r.text : null)
      set({ confirm: { tone: 'ask', ...opts, prompt: { placeholder: opts.placeholder } } })
    }),
  resolveConfirm: (ok, text = '') => {
    const r = confirmResolve
    confirmResolve = null
    set({ confirm: null })
    r?.({ ok, text })
  },
  setActiveLine: (n) => set((s) => (s.activeLine === n ? {} : { activeLine: n })),
  setJobProgress: (v) => set((s) => (s.jobProgress === v ? {} : { jobProgress: v })),
  setResumeLine: (n) => set({ resumeLine: n }),
  setParked: (parked) => set({ parked }),
  setParkLine: (parkLine) => set({ parkLine }),
  setParkProgress: (parkProgress) => set({ parkProgress }),
  setParkPos: (parkPos) => {
    if (parkPos) localStorage.setItem('parkPos', JSON.stringify(parkPos))
    else localStorage.removeItem('parkPos')
    set({ parkPos })
  }
}))

/** Load saved toolpath aux-button visibility (default: MIST + VAC on, FLOOD off). */
function loadAux(): { vac: boolean; mist: boolean; flood: boolean } {
  const def = { vac: true, mist: true, flood: false }
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('auxButtons') || '{}') }
  } catch {
    return def
  }
}

/** How far, and how fast, the guided escape backs an axis off a limit switch.
 *  Short and slow on purpose: hard limits are off for this move, so a wrong guess
 *  by the operator costs 10 mm at a speed they can still react to. */
export const ESCAPE_MM = 10
const ESCAPE_FEED = 500

function escapeJogLine(axis: string, dir: 1 | -1): string {
  return `$J=G91 G21 ${axis}${dir * ESCAPE_MM} F${ESCAPE_FEED}`
}

/** grblHAL accepts `$` reads and writes only when Idle (or held in Alarm/E-stop);
 *  anything else comes back as error:8 and is silently not applied. */
function settingsWritable(state: string | undefined): boolean {
  const base = (state ?? '').split(':')[0]
  return base === 'Idle' || base === 'Alarm'
}

/** Is any limit switch reported as engaged? grblHAL lists active inputs as letters
 *  in `Pn:` — axis letters mean that axis' limit input (the rest are P/D/H/R/S/E…).
 *  Both a MIN and a MAX switch show up as the same letter, which is exactly why a
 *  machine with them on one input can't tell which end it is parked against. */
export function hasLimitPin(pins: string | null): boolean {
  return !!pins && /[XYZABC]/.test(pins)
}

/** How long the reported position has to hold still before the machine counts as
 *  stopped. Two poll intervals at the 20 Hz motion rate, so a momentary pause
 *  between two legs of a parking move — the slow pull-out handing over to the fast
 *  park — is not mistaken for the end of it. */
const SETTLE_MS = 250
let lastPosKey = ''
let lastMoveAt = 0

/** When the board last answered a LINE — an `ok` or an `error:`. */
let parserAliveAt = 0

/** How long ago the line parser last proved it was running, in ms; Infinity if it
 *  never has on this connection.
 *
 *  The guided recovery hangs off this. Its whole premise is a board that answers `?`
 *  and nothing else, and it used to test that premise by asking whether one specific
 *  command — `$I` — had come back. That is a much narrower question, and on 1 Aug it
 *  answered wrong twice on a perfectly healthy machine: once with the board suspended
 *  in Door, and once with the board plainly replying (the console had just printed
 *  eight `[SPINDLE:…]` lines and two `ok`s) while the dialog on top of it offered to
 *  erase the settings. An operator reading a screen that says "recover the board",
 *  shows an empty toolpath and has lost an axis will believe the machine was wiped,
 *  and act on it. That is not a UI problem. */
export function parserSilentFor(): number {
  return parserAliveAt ? Date.now() - parserAliveAt : Infinity
}

/** How close together two identical lines must be to count as one event. What the
 *  collapsing is for is a burst — a job that error:9's every buffered line, or an
 *  ok flood — and a burst arrives in milliseconds. A second later is not a burst. */
const COLLAPSE_MS = 1000

/** Append a console line, collapsing an identical consecutive repeat into a
 *  "×N" counter (with a refreshed timestamp) instead of flooding.
 *
 *  Only within COLLAPSE_MS of the one before it. Without that window a deliberate
 *  repeat looked like nothing happened: press MIST, wait twenty seconds, press it
 *  again, and the terminal did not add a row — it turned the old one into "×2" and
 *  moved its timestamp. Two identical presses well apart are two events and the
 *  operator is entitled to see both, which matters most for the realtime toggles,
 *  where the console echo is the only proof the press was sent at all. */
function cap(lines: ConsoleLine[], text: string): ConsoleLine[] {
  const last = lines[lines.length - 1]
  const now = Date.now()
  if (last && last.text === text && now - last.time < COLLAPSE_MS) {
    return [...lines.slice(0, -1), { text, time: now, n: last.n + 1 }]
  }
  const next = [...lines, { text, time: now, n: 1 }]
  return next.length > MAX_CONSOLE ? next.slice(next.length - MAX_CONSOLE) : next
}

/** Update one axis of the max-travel tuple as $130/$131/$132 lines arrive. */
function withTravel(cur: [number, number, number] | null, idx: number, val: number): [number, number, number] {
  const next: [number, number, number] = cur ? [...cur] : [0, 0, 0]
  next[idx] = val
  return next
}

/** First three numbers of a CSV (X,Y,Z), ignoring any extra axes. */
function firstThree(csv: string): [number, number, number] {
  const n = csv.split(',').map(Number)
  return [n[0] || 0, n[1] || 0, n[2] || 0]
}

/** Pull the active WCS (G54-G59.x) from a `[GC:...]` parser-state report.
 *  (Display units are owned by $13, not the gcode G20/G21 modal.) */
function parseParserState(line: string): { wcs?: string } {
  const m = /\[GC:([^\]]*)\]/.exec(line)
  if (!m) return {}
  const tokens = m[1].split(/\s+/)
  const out: { wcs?: string } = {}
  for (const t of tokens) {
    if (/^G5[4-9](\.\d)?$/.test(t)) out.wcs = t
  }
  return out
}
