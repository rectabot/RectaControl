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
import type { ConnectOptions, ControllerEvent, MachineInfo, ResumeMap, TransportKind } from '@shared/types'
import type { Transport } from './transport'
import { SerialTransport, listPorts } from './transport/serial'
import { EthernetTransport } from './transport/ethernet'

const POLL_MS = 200 // idle status '?' interval (~5 Hz)
const JOB_POLL_MS = 50 // status '?' interval while running (~20 Hz) — finer tool
// position sampling so the editor highlight scrolls through lines, not just a few
const RX_BUFFER = 127 // conservative serial RX buffer size for flow control

/** Realtime bytes worth echoing into the console, by the name the operator
 *  pressed. Deliberately excludes '?' polls and the override nudges. */
const ECHOED_REALTIME: Record<number, string> = {
  [RT.softReset]: 'Reset',
  [RT.feedHold]: 'Hold',
  [RT.resume]: 'Resume' // '~' — cycle start / resume
}

export class Controller {
  private transport: Transport | null = null
  private parser = new StatusParser()
  // Decode incoming bytes as UTF-8 (g-code comments may contain accented chars
  // like š/ž/č); StringDecoder buffers multibyte sequences split across packets.
  private decoder = new StringDecoder('utf8')
  private rxBuf = ''
  private pollTimer: ReturnType<typeof setInterval> | null = null

  // streaming state
  private lines: string[] = []
  // For each streamed line, its line index in the *source text* that startJob
  // received. Lets each ack be mapped back to the G-code line for the highlight.
  private lineMap: number[] = []
  // When set (From Line), translates a source-text index into a real file index.
  private resume: ResumeMap | null = null
  private nextIndex = 0
  private inflight: number[] = [] // char counts of lines awaiting ok/error
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

  private info: MachineInfo = { version: null, board: null, options: null, axes: [], spindle: null, spindles: [] }

  constructor(private emit: (e: ControllerEvent) => void) {}

  // --------------------------------------------------------------- lifecycle
  async connect(opts: ConnectOptions): Promise<void> {
    if (this.transport?.isOpen) await this.disconnect()

    this.transport =
      opts.kind === 'usb'
        ? new SerialTransport(opts.port, opts.baud)
        : new EthernetTransport(opts.host, opts.port)

    this.transport.onData((chunk) => this.onData(chunk))
    this.transport.onClose((reason) => this.onClose(reason))

    // fresh capability info per connection (axes/spindle re-discovered from $I)
    this.info = { version: null, board: null, options: null, axes: [], spindle: null, spindles: [] }

    await this.transport.open()
    this.emit({ type: 'connected', data: { kind: opts.kind } })

    this.startPoll()
    // ask the controller who it is + current parser state (WCS / units)
    setTimeout(() => this.sendLine('$I'), 250)
    setTimeout(() => this.sendLine('$G'), 400)
    // enumerate the registered spindles (machine-readable) so the $395 picker can
    // list the real drivers this firmware carries (analog PWM + every Modbus VFD).
    setTimeout(() => this.sendLine('$SPINDLESH'), 550)
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
    // 1) Ethernet (telnet on the W5500) — preferred.
    try {
      await this.connect({ kind: 'ethernet', host: opts.ethHost, port: opts.ethPort })
      return 'ethernet'
    } catch {
      /* board silent on TCP — try the USB cable instead */
    }

    // 2) USB CDC — pick the most likely board port (RP2350 enumerates as a
    //    Raspberry Pi / Pico CDC device), else the first port available.
    try {
      const ports = await listPorts()
      if (!ports.length) return null
      const pick =
        ports.find((p) =>
          /pico|rp2|raspberry|grbl|cdc|usb serial|wch|board/i.test(`${p.manufacturer ?? ''} ${p.path}`)
        ) ?? ports[0]
      await this.connect({ kind: 'usb', port: pick.path, baud: opts.baud })
      return 'usb'
    } catch {
      return null
    }
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

  // ------------------------------------------------------------------ output
  /** Send a single command line (MDI). Appends newline. */
  sendLine(line: string): void {
    if (!this.transport?.isOpen) return
    this.transport.write(line + '\n')
    this.emit({ type: 'sent', data: line })
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
    this.acked = 0
    this.startTime = Date.now()
    this.running = true
    this.paused = false
    this.repoll() // speed up position sampling for the highlight
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

  pauseJob(): void {
    if (this.running && !this.paused) {
      this.sendRealtime(RT.feedHold)
      this.paused = true
      this.emitJob()
    }
  }

  resumeJob(): void {
    if (this.running && this.paused) {
      this.sendRealtime(RT.resume)
      this.paused = false
      this.emitJob()
    }
  }

  stopJob(): void {
    this.sendRealtime(RT.softReset)
    this.resetJob()
    this.repoll() // back to gentle idle polling
    this.emit({ type: 'active', data: -1 })
    this.emitJob()
  }

  /** Abort a running job because a streamed line was rejected: tear down the
   *  stream so none of the remaining program is sent. We deliberately do NOT
   *  soft-reset — a reset spews the welcome banner (noise) and would wipe the
   *  error from the status bar, hiding the recovery popup. The few lines already
   *  in grblHAL's RX buffer drain on their own (collapsed to one console line),
   *  and the triggering error is emitted by the caller so the UI shows what went
   *  wrong + how to recover. */
  private abortOnError(): void {
    this.resetJob()
    this.repoll() // back to gentle idle polling
    this.emit({ type: 'active', data: -1 })
    this.emitJob()
  }

  private resetJob(): void {
    this.running = false
    this.paused = false
    this.lines = []
    this.lineMap = []
    this.resume = null
    this.nextIndex = 0
    this.inflight = []
    this.acked = 0
  }

  /** Send as many queued lines as fit in the RX buffer (character counting). */
  private pump(): void {
    if (!this.running || this.paused || !this.transport?.isOpen) return
    while (this.nextIndex < this.lines.length) {
      const line = this.lines[this.nextIndex]
      const cost = line.length + 1 // include the newline
      const queued = this.inflight.reduce((a, b) => a + b, 0)
      if (queued + cost >= RX_BUFFER && this.inflight.length > 0) break
      this.transport.write(line + '\n')
      this.inflight.push(cost)
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

    // job flow control: ok / error are responses to streamed lines
    let abortAfter = false
    if (this.running && (line === 'ok' || /^error:/i.test(line))) {
      if (/^error:/i.test(line)) {
        // a streamed line was rejected — abort the whole job (below) instead of
        // pushing the rest, which would just error on every remaining line. We
        // defer the teardown until AFTER emitting the error line, so the renderer
        // still sees the job as running and auto-opens the recovery popup.
        abortAfter = true
      } else {
        this.inflight.shift()
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
          this.resetJob()
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
    const spEnum = parseSpindleEntry(line) // machine-readable $SPINDLESH entry, or null
    let changed = false
    if (spEnum) {
      // upsert by id (ids are stable across re-queries), keep numeric order
      const arr = this.info.spindles.filter((s) => s.id !== spEnum.id)
      arr.push(spEnum)
      arr.sort((a, b) => a.id - b.id)
      this.info.spindles = arr
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
