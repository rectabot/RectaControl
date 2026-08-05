/**
 * Controller — owns the active transport and the grbl protocol state machine.
 *
 * Responsibilities:
 *  - line-buffer incoming bytes, parse status reports, surface every line
 *  - poll '?' at a fixed rate and push parsed status to the renderer
 *  - stream a G-code job using CHARACTER-COUNTING flow control (keeps the
 *    grblHAL serial RX buffer full without overflowing it — smooth motion)
 *  - realtime commands (feed-hold / resume / soft-reset / jog-cancel)
 *
 * Events are pushed out via the `emit` callback wired up by ipc.ts.
 */

import { StringDecoder } from 'node:string_decoder'
import { StatusParser, RT, stripComment, parseSpindleEntry } from '@shared/grbl'
import type { ConnectOptions, ControllerEvent, LinkState, MachineInfo, ResumeMap, TransportKind } from '@shared/types'
import type { Transport } from './transport'
import { SerialTransport, pickBoardPort } from './transport/serial'
import { EthernetTransport } from './transport/ethernet'
import { RESCUE, type RescueAction } from './rescue'
import { SettingsBackup } from './settingsBackup'
import { log } from './logger'

/** The question a serial port has to answer before the app calls it a board.
 *
 *  `?` and nothing else. It is the one thing grblHAL answers in EVERY state: realtime
 *  bytes are served from the receive interrupt, so a machine parked in Door, held, in
 *  Alarm, homing or mid-cut replies to it while every line command waits. Probing with
 *  `$I` instead would connect to a running machine and refuse a parked one, which is
 *  the everyday case since parking pauses became normal.
 *
 *  Two seconds and a repeat every half second: a healthy board answers in single-digit
 *  milliseconds, so this is only ever paid by a port that is not the board. */
const USB_PROBE = { bytes: Buffer.from([RT.status]), timeoutMs: 2000, everyMs: 500 }

const POLL_MS = 200 // idle status '?' interval (~5 Hz)
const JOB_POLL_MS = 50 // status '?' interval while running (~20 Hz) — finer tool
// position sampling so the editor highlight scrolls through lines, not just a few
const RX_BUFFER = 127 // conservative serial RX buffer size for flow control

/** Realtime bytes worth echoing into the console, by the name the operator
 *  pressed. Deliberately excludes '?' polls and the override nudges. */
const ECHOED_REALTIME: Record<number, string> = {
  [RT.softReset]: 'Reset',
  [RT.feedHold]: 'Hold',
  [RT.resume]: 'Resume', // '~' — cycle start / resume
  // The coolant toggles are the one case where the operator presses a button and
  // the only evidence it worked is the machine itself. On 1 Aug a press mid-program
  // did nothing visible, and there was no way to tell whether the app had sent the
  // byte or the board had ignored it — because a realtime byte leaves no trace. It
  // does now, which splits that question in two.
  [RT.floodToggle]: 'Flood',
  [RT.mistToggle]: 'Mist',
  // Labelled for what the operator pressed, not for the byte they got: they pressed
  // Pause. Calling it `Park` collided with the Park button, which sends G53 moves and
  // is a different thing entirely — a log with both in it could not be read. The
  // board's own `[MSG:Check Door]` follows immediately, so the door command
  // underneath is never hidden from anyone reading it.
  [RT.safetyDoor]: 'Pause'
}

/** One line written to the board and still awaiting its `ok` / `error`. `job` marks
 *  the ones the streamed program owns — only those move progress. Manual lines ride
 *  the same queue purely so their bytes are counted against the RX buffer. */
type Slot = { cost: number; job: boolean }

/** Same board, same cable — asked for twice. Baud is deliberately part of it: changing
 *  it is a different link even though the port is the same. */
function sameTarget(a: ConnectOptions | null, b: ConnectOptions): boolean {
  if (!a || a.kind !== b.kind) return false
  return a.kind === 'usb' && b.kind === 'usb'
    ? a.port === b.port && a.baud === b.baud
    : a.kind === 'ethernet' && b.kind === 'ethernet'
      ? a.host === b.host && a.port === b.port
      : false
}

export class Controller {
  private transport: Transport | null = null
  /** Which cable the live transport is — the transports themselves do not say. */
  private kind: TransportKind | null = null
  /** What the live transport was opened with, so a repeated ask can be recognised as
   *  the same board rather than served as a new connection. */
  private connOpts: ConnectOptions | null = null
  private parser = new StatusParser()
  // Decode incoming bytes as UTF-8 (g-code comments may contain accented chars
  // like š/ž/č); StringDecoder buffers multibyte sequences split across packets.
  private decoder = new StringDecoder('utf8')
  private rxBuf = ''
  /** mirrors every $$ dump to disk (see settingsBackup.ts) */
  private backup = new SettingsBackup()
  /** armed by probeLine(); fired by the first ordinary line that comes back */
  private probeResolve: (() => void) | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null

  // streaming state
  private lines: string[] = []
  // For each streamed line, its line index in the *source text* that startJob
  // received. Lets each ack be mapped back to the G-code line for the highlight.
  private lineMap: number[] = []
  // When set (From Line), translates a source-text index into a real file index.
  private resume: ResumeMap | null = null
  private nextIndex = 0
  private inflight: Slot[] = [] // lines awaiting ok/error, in the order they were written
  // Operator lines (MDI, jog, a button, an automatic $# / $$) raised while a program
  // streams. They wait here instead of going straight out, so the same character
  // counting that meters the program meters them too — see sendLine().
  private manualQueue: string[] = []
  private acked = 0
  private startTime = 0
  private running = false
  private paused = false
  // True whenever the machine reports an active (moving) state — Run/Jog/Hold/
  // Home/Door. Drives the fast position poll for ANY motion, not just app-streamed
  // jobs: an SD / external run (`$F=`) has no `running` flag, so without this its
  // position would only sample at 5 Hz and small arcs would look faceted (the tool
  // marker jumping ~120° per update).
  private motionActive = false

  private info: MachineInfo = { version: null, board: null, options: null, axes: [], spindle: null, firmwareBuild: null, newopt: null, spindles: [] }

  constructor(private emit: (e: ControllerEvent) => void) {}

  // --------------------------------------------------------------- lifecycle
  async connect(opts: ConnectOptions): Promise<void> {
    // Already talking to this board? Then keep talking to it.
    //
    // The link lives in this process; the window does not. A renderer reload — a dev
    // rebuild, F5, a crash the ErrorBoundary recovered from — brings up a fresh App.tsx
    // that knows nothing and runs its startup auto-connect, which used to tear down a
    // perfectly good session in order to build the same one again. On 3 Aug 2026 that is
    // exactly what locked us out: the socket closed and the replacement asked for a
    // session 2 ms later, while the board still had the old one. Seventeen minutes of
    // being refused, from a reconnect nobody needed.
    //
    // Re-announcing is all the new window actually wants — the `connected` event plus
    // the same discovery a fresh connection runs, which repopulates what it lost.
    if (this.transport?.isOpen && sameTarget(this.connOpts, opts)) {
      this.emit({ type: 'connected', data: { kind: opts.kind } })
      this.announce(true)
      return
    }

    const replacing = this.transport?.isOpen ? this.kind : null
    if (this.transport?.isOpen) await this.disconnect()

    // Let go of the old telnet session before asking for a new one. Closing sends a FIN
    // and returns as soon as the local socket is down — the board has not necessarily
    // read it yet. On 3 Aug 2026 the new SYN went out 2 ms behind the FIN; the daemon,
    // which serves one client, was still holding the old session and refused every
    // socket for the next 17 minutes. This is only the sequencing of a reconnect, so a
    // quarter of a second costs nothing and is the difference between reconnecting and
    // locking ourselves out. USB has no such state.
    if (replacing === 'ethernet' && opts.kind === 'ethernet')
      await new Promise((r) => setTimeout(r, 250))
    this.kind = opts.kind
    this.connOpts = opts

    this.transport =
      opts.kind === 'usb'
        ? new SerialTransport(opts.port, opts.baud, USB_PROBE)
        : new EthernetTransport(opts.host, opts.port)

    this.transport.onData((chunk) => this.onData(chunk))
    this.transport.onClose((reason) => this.onClose(reason))

    // Start reading from a clean slate. A board that reboots — which is exactly
    // what flashing, a soft reset or a pulled cable does — cuts the stream in the
    // middle of a line, and that fragment used to survive here: the next session's
    // first bytes were glued onto it and the result was parsed as one line. A
    // status report built that way can carry fewer axes than $I promises, which
    // took the DRO down with `undefined.toFixed()`.
    this.rxBuf = ''
    this.decoder = new StringDecoder('utf8')

    // fresh capability info per connection (axes/spindle re-discovered from $I)
    this.info = { version: null, board: null, options: null, axes: [], spindle: null, firmwareBuild: null, newopt: null, spindles: [] }

    await this.transport.open()
    this.emit({ type: 'connected', data: { kind: opts.kind } })

    this.startPoll()
    this.announce()
  }

  /** Ask the board to introduce itself. Everything the UI needs and cannot guess:
   *  who it is, what parser state it is in, and which spindles this firmware carries.
   *  Run on every fresh connection, and again when a reloaded window rejoins one that
   *  was already up — the board's answers are what fills the new window in.
   *
   *  `rejoin` is the difference between a board that may still be booting and one that
   *  has been answering for the last quarter of an hour. A fresh connection staggers the
   *  three questions and gives the board a moment first; a rejoin asks at once, and does
   *  not ask the window to wait for the answers at all — this process already has them,
   *  and handing them over is instant.
   *
   *  Without that, a reload left the DRO showing three axes for very nearly a second on
   *  a four-axis machine: window shown at 17:37:04.723, `$I` sent at 17:37:05.665. It
   *  was right in the end, which is the kind of wrong that is worse — the operator sees
   *  an axis vanish and reappear and has no way to know it was only the screen. */
  private announce(rejoin = false): void {
    if (rejoin && this.info.version) this.emit({ type: 'info', data: { ...this.info } })
    // ask the controller who it is + current parser state (WCS / units)
    setTimeout(() => this.sendLine('$I'), rejoin ? 0 : 250)
    this.askParserState(rejoin ? 50 : 400)
    // enumerate the registered spindles (machine-readable) so the $395 picker can
    // list the real drivers this firmware carries (analog PWM + every Modbus VFD).
    setTimeout(() => this.sendLine('$SPINDLESH'), rejoin ? 100 : 550)
    // Units are owned by the controller's $13 (report inches). We no longer pin
    // $13 — the unit is set exclusively via the $13 setting and the display
    // (DRO/header) reflects whatever the controller reports.
  }

  /**
   * Auto-connect: try Ethernet first, fall back to USB. Both cables can be
   * plugged in at once — we prefer the network link (faster, FTP-capable) and
   * only drop to the serial port if the board doesn't answer on TCP. Returns the
   * transport kind that came up, or null if neither did.
   */
  async autoConnect(opts: {
    ethHost: string
    ethPort: number
    baud: number
  }): Promise<TransportKind | null> {
    // Already on a cable? Then there is nothing to choose. A window that reloads runs
    // this on startup, and re-deciding would drop a USB link — the one the flash flow
    // puts the board on — in order to go looking for the network. Rejoin what is up.
    if (this.transport?.isOpen && this.connOpts) {
      await this.connect(this.connOpts)
      return this.kind
    }

    // 1) Ethernet (telnet on the W5500) — preferred.
    try {
      await this.connect({ kind: 'ethernet', host: opts.ethHost, port: opts.ethPort })
      return 'ethernet'
    } catch {
      /* board silent on TCP — try the USB cable instead */
    }

    // 2) USB CDC — pick the most likely board port (see pickBoardPort), and let the
    //    probation there decide whether it is one. Both halves of that are new as of
    //    5 Aug 2026 and both are load-bearing: this fallback is reached whenever the
    //    network drops, which includes the board simply being switched off, and until
    //    now it answered "connected over usb" on a machine with no power.
    try {
      const path = await pickBoardPort()
      if (!path) {
        log('app', 'auto-connect: no board on USB either (no USB serial device present)')
        return null
      }
      await this.connect({ kind: 'usb', port: path, baud: opts.baud })
      return 'usb'
    } catch (e) {
      log('app', `auto-connect: ${(e as Error).message}`)
      return null
    }
  }

  /** See RectaApi.markSettingsFactory. Called by whoever is about to do something
   *  that can reset NVS — flashing, or a rescue erase — because the app knows that
   *  with certainty and the board's own announcement does not survive the reboot:
   *  it is printed at startup, seconds before anything reconnects to hear it. */
  markSettingsFactory(): void {
    this.backup.markFactory()
  }

  /** The machine's own settings are back on the board — file dumps normally again. */
  clearSettingsFactory(): void {
    this.backup.clearFactory()
  }

  /** See RectaApi.settingsBackups. Routed through the backup so each row can be
   *  judged against the spindles this firmware registers. */
  listSettingsBackups(): ReturnType<SettingsBackup['list']> {
    return this.backup.list()
  }

  /** Fire a rescue pair down the live connection. Returns false when there is none
   *  to fire it down — the caller then falls back to the blind serial path. */
  sendRescue(action: RescueAction): boolean {
    if (!this.transport?.isOpen) return false
    this.transport.write(RESCUE[action])
    this.emit({ type: 'sent', data: `[rescue:${action}]` })
    return true
  }

  /** Does the board execute commands, as opposed to merely being alive?
   *
   *  This is the whole question, and `?` cannot answer it: realtime bytes are handled
   *  in the receive interrupt and keep replying on a board whose line parser is
   *  suspended. So ask something only the parser can answer and wait for any ordinary
   *  line to come back. `$I` is the right probe — it is refused in no state, it does
   *  not move anything, and its reply is the same information the app wants anyway.
   */
  /** Ask for the parser state (`$G`) — at most once per connection event.
   *
   *  Two places want it and both are right: opening a connection, because we do not
   *  know what WCS or units the board is in, and the grblHAL greeting, because a
   *  reset takes the parser state and the homed reference with it.
   *
   *  They are not two events, though. That banner means BOTH "I have just booted"
   *  AND "hello, new connection" — it arrives about a millisecond after the socket
   *  opens — so every ordinary connect fired both and asked twice. Same trap that
   *  had me telling Filip the board had rebooted when it had not (1 Aug 2026), seen
   *  from the other side. Whichever fires first wins and the other stands down; the
   *  window is wide enough to cover the gap between them and far short of anything
   *  that could legitimately ask again. */
  private lastParserAsk = 0
  private askParserState(delayMs: number): void {
    if (Date.now() - this.lastParserAsk < 1500) return
    this.lastParserAsk = Date.now()
    setTimeout(() => this.sendLine('$G'), delayMs)
  }

  probeLine(timeoutMs = 2500): Promise<boolean> {
    if (!this.transport?.isOpen) return Promise.resolve(false)
    return new Promise((resolve) => {
      let settled = false
      const finish = (answered: boolean): void => {
        if (settled) return
        settled = true
        this.probeResolve = null
        clearTimeout(timer)
        resolve(answered)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      this.probeResolve = () => finish(true)
      this.sendLine('$I')
    })
  }

  async disconnect(): Promise<void> {
    this.stopPoll()
    this.resetJob()
    this.motionActive = false
    if (this.transport) {
      await this.transport.close()
      this.transport = null
    }
  }

  private onClose(reason?: string): void {
    this.stopPoll()
    this.resetJob()
    this.backup.reset() // a dump cut off by the disconnect is not a backup
    this.probeResolve = null // no line is coming now; let the probe time out as failed
    this.rxBuf = '' // half a line is not worth carrying into the next connection
    this.motionActive = false
    this.transport = null
    this.emit({ type: 'disconnected', data: { reason } })
  }

  get connected(): boolean {
    return !!this.transport?.isOpen
  }

  /** Whether a program is currently streaming (used to guard app-quit). */
  get isRunning(): boolean {
    return this.running
  }

  /** What `$I` said about this machine — the problem report ships it so a log can
   *  be read against the firmware and board that produced it. */
  get machineInfo(): MachineInfo {
    return { ...this.info }
  }

  /** Everything a window that has just appeared needs in order to stop guessing.
   *
   *  A fresh window assumes nothing is connected and finds out otherwise by trying to
   *  connect — which on a reload took 684 ms (measured 3 Aug 2026), and for all of it
   *  the DRO showed a three-axis machine because three is what it shows when it has not
   *  been told. The axis count was never in question: this process had it. Asking is
   *  immediate and it is the truth, where connecting-to-find-out is neither. */
  get linkState(): LinkState {
    const connected = !!this.transport?.isOpen
    return { connected, kind: connected ? this.kind : null, info: { ...this.info } }
  }

  // ------------------------------------------------------------------ output
  /** Send a single command line (MDI). Appends newline.
   *
   *  While a program streams the line does NOT go straight to the port — it joins the
   *  queue pump() meters. Writing past the stream broke it two ways at once:
   *   • the bytes landed in grblHAL's RX buffer without the flow control knowing, so
   *     the next pump could overfill it — the board drops the overflow and what it
   *     finally parses is a mangled G-code line;
   *   • the `ok` that came back was indistinguishable from a program line's and was
   *     counted as one, so progress and the editor highlight ran ahead of the cut and
   *     the job could be declared finished with lines still unsent.
   *  Both were live for anything that sends a line during a job — the console has no
   *  job gate at all, and $# / $$ go out on their own.
   *
   *  The echo is emitted here, at the press, not when the line actually leaves: the
   *  console should show what the operator asked for the moment they ask. */
  sendLine(line: string): void {
    if (!this.transport?.isOpen) return
    this.emit({ type: 'sent', data: line })
    if (this.running) {
      this.manualQueue.push(line)
      this.pump()
      return
    }
    this.transport.write(line + '\n')
  }

  sendRealtime(byte: number): void {
    if (!this.transport?.isOpen) return
    this.transport.write(Buffer.from([byte]))
    // Realtime bytes are invisible characters, so a console showing only `$`
    // lines makes a Reset look like nothing happened (it is exactly what the
    // controller needs after a hard limit). Echo the ones the operator presses;
    // status polls and override nudges stay silent — they would flood.
    const name = ECHOED_REALTIME[byte]
    if (name) this.emit({ type: 'sent', data: `[${name}]` })
    // A coolant toggle changes something the operator is looking at, and the only
    // way the app learns it happened is the `A:` field of a status report — the
    // button follows the machine, it never assumes. Waiting for the next scheduled
    // poll puts up to a full idle interval (200 ms) between the press and the
    // button lighting, which reads as a sluggish button. Ask right away instead;
    // the short delay lets the board act on the toggle first.
    if (byte === RT.floodToggle || byte === RT.mistToggle)
      setTimeout(() => {
        if (this.transport?.isOpen) this.sendRealtime(RT.status)
      }, 40)
  }

  // -------------------------------------------------------------------- jobs
  startJob(gcode: string, resume?: ResumeMap): void {
    if (!this.transport?.isOpen || this.running) return
    // Build the streamed lines AND, in lockstep, the map back to the source-text
    // line each one came from (skipping the same blank/comment-only lines), so an
    // ack can be turned into the exact G-code line for the editor highlight.
    this.lines = []
    this.lineMap = []
    gcode.split(/\r?\n/).forEach((l, idx) => {
      const s = stripComment(l).trim()
      if (s.length) {
        this.lines.push(s)
        this.lineMap.push(idx)
      }
    })
    this.resume = resume ?? null
    this.nextIndex = 0
    this.inflight = []
    this.manualQueue = []
    this.acked = 0
    this.startTime = Date.now()
    this.running = true
    this.paused = false
    this.repoll() // speed up position sampling for the highlight
    // Where a resumed run re-enters the file. Without it the log records a Park as a
    // stop and a start of unrelated size, and the one question anyone asks afterwards —
    // did it come back on the line it left? — can only be answered by counting the
    // lines of the file by hand, which is how 1 Aug 2026 had to be answered.
    if (this.resume) log('job', `resuming at file line ${this.resume.fileLine + 1} (+${this.resume.preambleLines}-line preamble)`)
    this.emit({ type: 'active', data: this.activeFileLine() })
    this.pump()
    this.emitJob()
  }

  /** The file line the highlight should sit on, derived from the ack count. The
   *  most-recently-acked line is the deepest the controller has confirmed; it
   *  leads the physical cut by the planner buffer, which is the standard sender
   *  behaviour. Returns -1 before the first ack. */
  private activeFileLine(): number {
    if (this.acked <= 0) return this.lineMap.length ? this.srcToFile(this.lineMap[0]) : -1
    const src = this.lineMap[Math.min(this.acked - 1, this.lineMap.length - 1)]
    return this.srcToFile(src)
  }

  /** Translate a source-text line index into a real file index. Identity for a
   *  normal run; for a From Line resume the synthetic preamble collapses onto the
   *  target line and the file tail is offset back to its true position. */
  private srcToFile(src: number): number {
    if (!this.resume) return src
    const { fileLine, preambleLines } = this.resume
    return src < preambleLines ? fileLine : fileLine + (src - preambleLines)
  }

  /** Pause the stream. `park` swaps the feed hold for the door command, which is the
   *  only thing that arms grblHAL's parking motion — see RT.safetyDoor. Either way
   *  the stream stops filling and the position is kept; the renderer decides which,
   *  because whether parking is safe depends on settings it already tracks. */
  pauseJob(park = false): void {
    if (this.running && !this.paused) {
      this.sendRealtime(park ? RT.safetyDoor : RT.feedHold)
      this.paused = true
      this.emitJob()
    }
  }

  resumeJob(): void {
    if (this.running && this.paused) {
      this.sendRealtime(RT.resume)
      this.paused = false
      // Restart the stream by hand. grblHAL acks a line when it PARSES it into the
      // planner, not when it cuts it, so a hold keeps acking until the planner fills
      // — within a moment there is nothing left in flight, and pump() refuses to send
      // while paused. With no ok left to arrive, nothing would ever call pump again:
      // the machine would run out the planner after the resume and then sit there
      // with the job still showing as running.
      this.pump()
      this.emitJob()
    }
  }

  stopJob(): void {
    // …and where it left off. The job event that follows a teardown reports 0/0 (the
    // stream is already gone by then), so this is the only record of the line a Stop —
    // or the abort behind a Park — happened on.
    if (this.running) log('job', `stopped at file line ${this.activeFileLine() + 1} (${this.acked}/${this.lines.length} acked)`)
    this.sendRealtime(RT.softReset)
    this.resetJob()
    this.repoll() // back to gentle idle polling
    this.emit({ type: 'active', data: -1 })
    this.emitJob()
  }

  /** Abort a running job: tear down the stream so none of the remaining program is
   *  sent. Called when a streamed line is rejected, when the machine alarms, and
   *  when the controller restarts. We deliberately do NOT soft-reset — a reset
   *  spews the welcome banner (noise) and would wipe the error from the status bar,
   *  hiding the recovery popup. The few lines already in grblHAL's RX buffer drain
   *  on their own (collapsed to one console line), and the triggering line is
   *  emitted by the caller so the UI shows what went wrong + how to recover. */
  private abortOnError(): void {
    // The streamed lines never pass through sendLine (they would flood the log at
    // 20 acks a second), so without this the log would show the alarm and not one
    // word about what the machine was cutting when it hit — which is the first
    // question anyone reading the log has.
    if (this.running) {
      const idx = Math.max(0, this.acked - 1)
      log('job', `aborted at file line ${this.activeFileLine() + 1}: ${this.lines[idx] ?? '?'} (${this.acked}/${this.lines.length} acked)`)
    }
    this.resetJob()
    this.repoll() // back to gentle idle polling
    this.emit({ type: 'active', data: -1 })
    this.emitJob()
  }

  /** Tear the stream down.
   *
   *  `flushManual` decides what happens to an operator line still queued behind the
   *  program. On a normal finish it is owed — the console already showed it as sent,
   *  and the only reason it is still here is that the RX buffer was full — so it goes
   *  out now, unmetered, because there is no longer a stream to meter it against.
   *  Every other path DROPS it, and that is the whole point: Stop, an alarm and a
   *  controller restart have just brought the machine to a halt, and firing a stale
   *  motion command into a machine somebody just stopped is the one outcome nobody
   *  wants. Dropped lines are logged so the log does not disagree with the console. */
  private resetJob(flushManual = false): void {
    this.running = false
    this.paused = false
    this.lines = []
    this.lineMap = []
    this.resume = null
    this.nextIndex = 0
    this.inflight = []
    this.acked = 0
    const pending = this.manualQueue
    this.manualQueue = []
    if (!pending.length) return
    if (flushManual && this.transport?.isOpen) for (const l of pending) this.transport.write(l + '\n')
    else log('job', `dropped ${pending.length} queued manual line(s) on teardown: ${pending.join(' | ')}`)
  }

  /** Send as many queued lines as fit in the RX buffer (character counting).
   *
   *  Manual lines go out ahead of the program: there are never many, and one is the
   *  operator asking for something now — the program is the thing that can wait a
   *  buffer's worth. They are also sent during a feed hold, where the program is not:
   *  a line raised while holding belongs behind what the planner already has, and
   *  queueing it there is what lets it run the instant the hold lifts. */
  private pump(): void {
    if (!this.transport?.isOpen) return
    const write = (line: string, job: boolean): boolean => {
      const cost = line.length + 1 // include the newline
      const queued = this.inflight.reduce((a, s) => a + s.cost, 0)
      if (queued + cost >= RX_BUFFER && this.inflight.length > 0) return false
      this.transport!.write(line + '\n')
      this.inflight.push({ cost, job })
      return true
    }
    while (this.manualQueue.length) {
      if (!write(this.manualQueue[0], false)) return // buffer full — retry on the next ok
      this.manualQueue.shift()
    }
    if (!this.running || this.paused) return
    while (this.nextIndex < this.lines.length) {
      if (!write(this.lines[this.nextIndex], true)) return
      this.nextIndex++
    }
  }

  // --------------------------------------------------------------- ingestion
  private onData(chunk: Buffer): void {
    this.rxBuf += this.decoder.write(chunk)
    let nl: number
    while ((nl = this.rxBuf.indexOf('\n')) >= 0) {
      const line = this.rxBuf.slice(0, nl).replace(/\r$/, '')
      this.rxBuf = this.rxBuf.slice(nl + 1)
      if (line.length) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    const status = this.parser.parse(line)
    if (status) {
      this.emit({ type: 'status', data: status })
      // speed the position poll up/down with the machine's motion state, so SD /
      // external runs (and jogging) sample position finely too — not just streamed
      // jobs. Smooth tool marker + tracking on small arcs.
      const st = (status.state ?? '').split(':')[0]
      const active = st === 'Run' || st === 'Jog' || st === 'Hold' || st === 'Home' || st === 'Door'
      if (active !== this.motionActive) {
        this.motionActive = active
        this.repoll()
      }
      return
    }

    // Any ordinary line proves the parser is running — which is the one thing the
    // rescue needs to know and the one thing a status report cannot show. Placed
    // after the status-report return above, so a `<Idle|…>` never answers for it.
    this.probeResolve?.()

    // A board that has just lost its settings is about to dump factory values, and the
    // app pulls `$$` on every connect — so without this the newest backup silently
    // becomes the factory one, at exactly the moment the operator needs the real one
    // to put the machine back. On 30 Jul 2026 that was only avoided by copying the file
    // out by hand before reconnecting, which is not something a customer will know to do.
    //
    // Two signals, no guessing at content: `error:7` is the core saying it could not read
    // NVS and has restored defaults (what a variant flash causes — the 29 Jul wipe), and
    // the driver's own message covers a deliberate erase over the rescue path.
    if (/^error:7\b/.test(line) || /Settings were erased by a recovery request/i.test(line))
      this.backup.markFactory()

    this.backup.feed(line)

    // Every teardown below is deferred until after the line is emitted, so the
    // renderer still sees the job as running and opens the recovery popup.
    let abortAfter = false

    // grblHAL LATCHES a rejection. With COMPATIBILITY_LEVEL 0 — which is the default
    // and what our firmware builds with — protocol.c only parses a block while
    // gc_state.last_error is clear, and reports the OLD error for every line that
    // follows. So a refused line does not merely fail: the machine then refuses
    // everything, answering with a code that has nothing to do with what was sent.
    //
    // Confirmed on the board, 5 Aug 2026 — `M99` -> error:20, then `G21` -> error:20,
    // on a machine sitting Idle with no alarm. Until now the app left it that way:
    // abortOnError() deliberately does not soft-reset (a reset would bury the error the
    // recovery popup is about), so the operator met a machine that refused their next
    // move with a stale code, while jogging still worked because `$J=` takes a
    // different branch. Nothing said why.
    //
    // The way out is the firmware's own: an empty line, which protocol.c handles as
    // "Empty line. For syncing purposes." and which sets last_error back to OK.
    const syncAfter = /^error:/i.test(line)

    // An alarm ends the job outright. The machine halted mid-motion, so its position
    // is no longer trustworthy and the rest of the program must not be streamed. This
    // is also what stops an E-stopped job from resuming the moment the operator
    // unlocks the machine, running to the end of the file and back on the program's
    // coordinates rather than theirs — the ok's from their $X / $H used to be read as
    // streamed lines acked and pumped the remainder out. Those ok's now answer manual
    // slots and move nothing (below), but the position argument stands on its own.
    if (this.running && /^ALARM:/i.test(line)) abortAfter = true

    // A welcome banner means the controller restarted. grblHAL drops the homed
    // reference on a reset that lost position ($676 bit 0) but does NOT announce
    // it — the |H: field is only appended when something asks. So ask: $G queues
    // the homed report, and the next status carries the truth. Without this the
    // app keeps believing a machine is referenced after an E-stop took that away.
    if (/grbl/i.test(line) && /for help/i.test(line)) {
      // the restart took the planner and the position with it, so anything we were
      // streaming is void — drop it rather than carry it across the reset
      if (this.running) abortAfter = true
      this.askParserState(200)
    }

    // The sync line's own `ok` answers nothing the operator asked for, and printing it
    // directly under a rejection reads as "never mind, that worked". Swallow it. Only
    // the unmetered case is counted here; while a program runs the sync rides the queue
    // and its reply is accounted for as the manual slot it is.
    if (this.syncPending > 0 && line === 'ok' && !this.inflight.length) {
      this.syncPending--
      return
    }

    // job flow control: ok / error answer the lines we metered out — the program's
    // and any operator line queued alongside them. They come back in the order the
    // lines were written, so the head of `inflight` says whose this one is. Getting
    // that attribution wrong is what used to run progress ahead of the cut.
    if (this.inflight.length && (line === 'ok' || /^error:/i.test(line))) {
      const slot = this.inflight.shift() as Slot
      if (/^error:/i.test(line)) {
        // A rejected PROGRAM line aborts the job (below) instead of pushing the rest,
        // which would just error on every remaining line. We defer the teardown until
        // AFTER emitting the error line, so the renderer still sees the job as running
        // and auto-opens the recovery popup.
        // A rejected MANUAL line is the operator's own typo in the console — it says
        // nothing about the program, so report it and keep cutting.
        if (slot.job) abortAfter = true
        else this.pump()
      } else if (!slot.job) {
        this.pump() // an acked manual line frees buffer space and nothing else
      } else {
        this.acked++
        // advance the editor highlight one confirmed line at a time (this is the
        // precise "where are we" signal — every line acked scrolls the highlight)
        this.emit({ type: 'active', data: this.activeFileLine() })
        if (this.acked >= this.lines.length && this.nextIndex >= this.lines.length) {
          // job completed normally → emit a final progress carrying the REAL
          // wall-clock duration + done flag (so the UI can remember this program's
          // run time), THEN tear down and emit the clean idle state.
          const total = this.lines.length
          this.emit({
            type: 'job',
            data: { running: false, paused: false, total, sent: total, elapsedMs: Date.now() - this.startTime, etaMs: 0, done: true }
          })
          this.resetJob(true) // the program is done; owed operator lines go out now
          this.repoll() // back to gentle idle polling
          this.emit({ type: 'active', data: -1 })
          this.emitJob()
        } else {
          this.pump()
        }
      }
    }

    this.captureInfo(line)
    this.emit({ type: 'line', data: line })

    if (abortAfter) this.abortOnError()
    // After the teardown, never before it: a program line's rejection tears the stream
    // down, and resetJob() drops whatever is queued — a sync queued ahead of that would
    // be thrown away with it.
    if (syncAfter) this.clearErrorLatch()
  }

  /** Give the machine back to the operator after a rejection — see the note in
   *  handleLine for what grblHAL does without this.
   *
   *  While a program streams the sync goes through the same queue that meters every
   *  other line, ahead of the program: writing past the character counting is the bug
   *  that was fixed on 1 Aug and it is not worth reintroducing for one byte. With no
   *  stream up there is nothing to meter it against, so it goes straight out. */
  private syncPending = 0
  private clearErrorLatch(): void {
    if (!this.transport?.isOpen) return
    if (this.running) {
      this.manualQueue.unshift('')
      this.pump()
    } else {
      this.syncPending++
      this.transport.write('\n')
    }
    log('app', 'sent a sync line to clear the error grblHAL had latched')
  }

  private captureInfo(line: string): void {
    const ver = /\[VER:([^\]]*)\]/.exec(line)
    const opt = /\[OPT:([^\]]*)\]/.exec(line)
    const board = /\[BOARD:([^\]]*)\]/.exec(line)
    const axs = /\[AXS:\d+:([A-Z]*)\]/.exec(line) // e.g. [AXS:4:XYZA]
    // Active-spindle name from $I — the plain, pipe-less form only ([SPINDLE:PWM]).
    // The machine-readable enumeration ([SPINDLE:0|-|11|...]) is handled separately
    // below; excluding '|' here keeps an enum line from clobbering the active name.
    const spindle = /\[SPINDLE:([^,|\]]*)\]/.exec(line)
    // our own build stamp: [PLUGIN:RectaBot firmware v1.0 4axis-rotary-a Jul 29 2026].
    // grblHAL's [VER:] only moves when the core does and [BOARD:] is a constant, so
    // this is the one line that says WHICH image is on the board — which the operator
    // needs after a flash, and support needs in every problem report.
    const fw = /\[PLUGIN:RectaBot firmware v([^\]]*)\]/.exec(line)
    // what this build carries — ETH/FTP/SD/HOME/… — so the UI can show the paths
    // this board HAS, not merely the one it came up on
    const nopt = /\[NEWOPT:([^\]]*)\]/.exec(line)
    const spEnum = parseSpindleEntry(line) // machine-readable $SPINDLESH entry, or null
    let changed = false
    if (spEnum) {
      // upsert by id (ids are stable across re-queries), keep numeric order
      const arr = this.info.spindles.filter((s) => s.id !== spEnum.id)
      arr.push(spEnum)
      arr.sort((a, b) => a.id - b.id)
      this.info.spindles = arr
      // the backup needs to know which drivers are Modbus to tell a complete dump from
      // one taken before the board restarted with a VFD selected
      this.backup.setSpindles(arr)
      changed = true
    }
    if (ver) {
      this.info.version = ver[1]
      changed = true
    }
    if (opt) {
      this.info.options = opt[1]
      changed = true
    }
    if (board) {
      this.info.board = board[1]
      changed = true
    }
    if (axs) {
      this.info.axes = axs[1].split('')
      changed = true
    }
    if (spindle) {
      this.info.spindle = spindle[1].trim()
      changed = true
    }
    if (fw) {
      this.info.firmwareBuild = fw[1].trim()
      changed = true
    }
    if (nopt) {
      this.info.newopt = nopt[1]
      changed = true
    }
    if (changed) this.emit({ type: 'info', data: { ...this.info } })
  }

  // -------------------------------------------------------------------- poll
  private startPoll(): void {
    this.stopPoll()
    // poll faster while a job runs OR the machine is otherwise moving, so the
    // position-based highlight/marker samples finely (SD & external runs included)
    const rate = this.running || this.motionActive ? JOB_POLL_MS : POLL_MS
    this.pollTimer = setInterval(() => {
      if (this.transport?.isOpen) this.sendRealtime(RT.status)
      if (this.running) this.emitJob()
    }, rate)
  }

  /** Switch the poll timer to the rate matching the current run state (fast while
   *  streaming, gentle when idle). Only touches an already-running poll loop. */
  private repoll(): void {
    if (this.pollTimer && this.transport?.isOpen) this.startPoll()
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private emitJob(): void {
    const elapsedMs = this.running ? Date.now() - this.startTime : 0
    let etaMs: number | null = null
    if (this.running && this.acked > 0 && elapsedMs > 0) {
      const rate = this.acked / elapsedMs
      etaMs = Math.max(0, (this.lines.length - this.acked) / rate)
    }
    this.emit({
      type: 'job',
      data: {
        running: this.running,
        paused: this.paused,
        total: this.lines.length,
        sent: this.acked,
        elapsedMs,
        etaMs
      }
    })
  }
}
