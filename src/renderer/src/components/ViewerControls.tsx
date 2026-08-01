import { useStore } from '../store'
import { RT } from '@shared/grbl'
import { useT, useLabel } from '../i18n'
import { AuxToggles } from './AuxToggles'
import { fmtDuration } from '../format'
import { rotateGcode } from '../gcodeRotate'
import { resumeFromPark, pauseProgram, parkOnPause, atRest } from '../controlActions'
import { PcIcon, SdIcon } from './icons'

/** Overlay controls that live inside the toolpath window (like ncSender):
 *  Load / Clear (top-right), Cycle / Pause / Stop (bottom-center), Probe (bottom-right). */
export function ViewerControls(): JSX.Element {
  const t = useT()
  const L = useLabel()
  const connected = useStore((s) => s.connected)
  const gcode = useStore((s) => s.gcode)
  const filename = useStore((s) => s.filename)
  const sdFile = useStore((s) => s.sdFile)
  const sdSource = useStore((s) => s.sdSource)
  const sdRunning = useStore((s) => s.sdRunning)
  const job = useStore((s) => s.job)
  const jobProgress = useStore((s) => s.jobProgress)
  const runTimes = useStore((s) => s.runTimes)
  const state = useStore((s) => s.status?.state)
  const clearFile = useStore((s) => s.clearFile)
  const setProbeOpen = useStore((s) => s.setProbeOpen)
  const setFilesOpen = useStore((s) => s.setFilesOpen)
  const setFromLineOpen = useStore((s) => s.setFromLineOpen)
  const setResumeLine = useStore((s) => s.setResumeLine)
  const setSdRunning = useStore((s) => s.setSdRunning)
  const rotationDeg = useStore((s) => s.rotationDeg)
  const setRotationDeg = useStore((s) => s.setRotationDeg)
  const askConfirm = useStore((s) => s.askConfirm)
  const parked = useStore((s) => s.parked)
  const settled = useStore((s) => s.settled)
  const limitsSuspended = useStore((s) => s.limitsSuspended != null)

  // progress by DISTANCE covered along the path (the Tracker follows the real tool
  // position by arc-length), NOT by lines acked — grblHAL acks a line the moment it
  // enters the planner buffer, so acked/total races to 100% while the machine is
  // still cutting the last (often long) moves.
  const pct = Math.round(jobProgress * 100)

  // time: elapsed ticks from the controller; the "total"/ETA prefers this
  // program's REAL time from a previous run (counts down from it), else the
  // ack-rate estimate. After a finish, show how long it actually took.
  const prevMs = filename ? runTimes[filename] : undefined
  const elapsedMs = job.running ? job.elapsedMs : 0
  const etaMs =
    job.running && prevMs !== undefined
      ? Math.max(0, prevMs - elapsedMs)
      : job.running && job.etaMs != null
        ? job.etaMs
        : null
  // grblHAL reports sub-states like "Hold:0" / "Door:1" — compare on the base.
  // 'Jog'/'Home' are intentionally excluded so jogging doesn't light Pause/Stop
  // or change Cycle.
  const base = (state ?? '').split(':')[0]
  const running = base === 'Run' || (job.running && !job.paused)
  const held = base === 'Hold' || base === 'Door' || job.paused
  // can't start a job while the machine is locked in Alarm — every streamed line
  // would just error:9. Unlock ($X) / home ($H) first. (Resume while held is fine.)
  const alarmed = base === 'Alarm'
  // …and a held machine is not necessarily a stopped one. A pause decelerates first,
  // and a parking pause then lifts the head — seconds of motion during which grblHAL
  // does NOT act on Cycle Start: the retract phase has no handler for it, so the
  // press vanishes. Which is what it looked like from the chair, too — Filip pressed
  // Resume during the lift, nothing happened, and the way out was to press Pause
  // again (dropped by the board, already in Door) so that Resume could be pressed a
  // second time. Same rule as the Park button: wait until the machine is at rest.
  const canResume = held && atRest(state, settled)
  // A program is active (app-streamed, SD-latched, or the machine is executing/
  // paused). Probing must be locked then — starting a G38 cycle mid-job injects
  // into the stream. (MIST/VAC/FLOOD stay live so the operator can override the
  // program's coolant by hand.)
  const programActive = running || held || sdRunning
  // program source, so the loaded file shows a PC vs SD-card icon (a leading "/"
  // used to be the only hint — easy to miss and mistake an SD file for a PC one)
  const fromSd = !!sdSource || !!sdFile || (filename?.startsWith('/') ?? false)

  return (
    <>
      {/* top-left: Load / Clear */}
      <div className="absolute left-3 top-2 flex items-center gap-2">
        <button
          className="flex items-center gap-1.5 rounded-md border border-brand/50 bg-panel/80 px-3 py-1 text-xs text-brand backdrop-blur transition hover:bg-brand hover:text-[#020617]"
          onClick={() => setFilesOpen(true)}
          title={t('ui.vc.loadTitle')}
        >
          <FolderIcon />
          {L('ui.vc.load')}
        </button>
        {filename && (
          <button
            className="rounded-md border border-border bg-panel/80 px-3 py-1 text-xs text-slate-400 backdrop-blur transition hover:border-danger hover:text-danger"
            onClick={clearFile}
            title={t('ui.vc.clearTitle')}
          >
            {L('ui.vc.clear')}
          </button>
        )}
      </div>

      {/* active software workpiece-rotation badge (top-center) — always visible while
          rotation is on, with one-click clear, so it's never silently applied */}
      {!!rotationDeg && (
        <div
          className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-warn/60 bg-panel/80 px-2.5 py-1 text-xs text-warn backdrop-blur"
          title={t('ui.rot.badgeTitle')}
        >
          <span className="font-mono">∠ {rotationDeg.toFixed(3)}°</span>
          <button
            className="rounded px-1 leading-none hover:bg-warn/20"
            onClick={() => setRotationDeg(0)}
            title={t('ui.rot.clear')}
          >
            ✕
          </button>
        </div>
      )}

      {/* filename + progress bar, above job buttons */}
      {filename && (
        <div className="absolute bottom-16 left-1/2 w-72 -translate-x-1/2 text-center">
          <div className="flex items-center justify-center gap-1.5 font-mono text-xs text-slate-300">
            <SourceIcon
              sd={fromSd}
              title={fromSd ? t('ui.vc.srcSd') : t('ui.vc.srcPc')}
            />
            <span className="truncate">{filename.replace(/^\//, '')}</span>
          </div>
          {job.running && (
            <>
              <div className="mt-1 h-2 overflow-hidden rounded-full border border-border bg-panel2">
                <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-0.5 flex items-center justify-center gap-2 font-mono text-[10px] text-slate-500">
                <span>{pct}%</span>
                <span>·</span>
                <span>⏱ {fmtDuration(elapsedMs)}</span>
                {etaMs != null && (
                  <>
                    <span>·</span>
                    <span>{t('ui.time.left', { time: fmtDuration(etaMs) })}</span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* bottom-center: job controls — driven by machine state so SD/external
          jobs can also be paused/stopped (not just app-streamed jobs) */}
      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2">
        <Pill
          color="ok"
          disabled={
            !connected ||
            running ||
            // hard limits are suspended for a switch rescue — nothing may run on an
            // unguarded machine, and the suspension ends on its own in seconds
            limitsSuspended ||
            // while parked the button IS Resume — only clickable once back in Idle
            (parked
              ? base !== 'Idle'
              : held
                ? !canResume // held, but still moving — see canResume
                : alarmed || (!gcode && !sdFile))
          }
          title={limitsSuspended ? t('ui.status.limitsOffTitle') : undefined}
          onClick={async () => {
            if (parked) {
              // parked (aborted to Idle for jogging) → this button resumes from the
              // parked line, NOT a fresh top-of-file start (that confused users)
              resumeFromPark()
            } else if (held) {
              job.paused ? window.recta.resumeJob() : window.recta.realtime(RT.resume)
            } else if (gcode) {
              setResumeLine(-1) // normal start → highlight from the top
              useStore.getState().setParked(false) // fresh run cancels a pending park
              useStore.getState().setParkProgress(0) // …and clears the frozen grey
              window.recta.startJob(rotateGcode(gcode, rotationDeg))
            } else if (sdFile) {
              // SD runs execute on the controller straight from the card, so software
              // rotation CAN'T be applied — warn before cutting an un-rotated part.
              if (
                rotationDeg &&
                !(await askConfirm({
                  title: t('ui.rot.sdTitle'),
                  body: t('ui.rot.sdBody', { deg: rotationDeg.toFixed(3) }),
                  confirmLabel: t('ui.rot.sdConfirm'),
                  tone: 'warn'
                }))
              )
                return
              // SD run executes on the controller (no app stream / progress), so
              // latch "program running" from now — it locks out jog/zeroing even
              // during the Idle window before the machine reaches Run.
              setSdRunning(true)
              window.recta.send(`$F=${sdFile}`)
            }
          }}
        >
          {parked || held ? L('ui.vc.resume') : L('ui.vc.cycle')}
        </Pill>
        <Pill
          color="warn"
          disabled={!running}
          onClick={pauseProgram}
          // Read at render, not subscribed: this component already re-renders on every
          // status report, and the tooltip only has to be right when it is hovered.
          title={t(parkOnPause() ? 'ui.vc.pauseParkTitle' : 'ui.vc.pauseHoldTitle')}
        >
          ❚❚ {L('ui.vc.pause')}
        </Pill>
        <Pill
          color="dangerSoft"
          disabled={!running && !held}
          onClick={() => {
            setSdRunning(false)
            useStore.getState().setParked(false) // a full stop abandons a pending park
            useStore.getState().setParkProgress(0) // …and clears the frozen grey
            window.recta.stopJob()
          }}
          title={t('ui.vc.stop')}
        >
          ■ {L('ui.vc.stop')}
        </Pill>
        <Pill
          color="muted"
          disabled={!connected || !gcode || running || held || alarmed}
          onClick={() => setFromLineOpen(true)}
          title={t('ui.vc.fromLineTitle')}
        >
          {L('ui.vc.fromLine')}
        </Pill>
      </div>

      {/* bottom-right: MIST / VAC toggles */}
      <div className="absolute bottom-3 right-3">
        <AuxToggles />
      </div>

      {/* bottom-left: Probe (Telegram mobile dark accent #3390EC) */}
      <button
        className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md border border-[#3390EC]/50 bg-panel/80 px-3 py-2 text-sm text-[#3390EC] backdrop-blur transition enabled:hover:bg-[#3390EC] enabled:hover:text-white disabled:opacity-40"
        disabled={!connected || programActive}
        onClick={() => setProbeOpen(true)}
        title={t('ui.vc.probeTitle')}
      >
        {L('ui.vc.probe')}
      </button>
    </>
  )
}

/** Program-source badge: an SD-card glyph when the loaded file came from the
 *  controller's SD card, else a monitor (PC) glyph. Both cyan (brand) — the shape
 *  carries the source; a tooltip spells it out. */
function SourceIcon({ sd, title }: { sd: boolean; title: string }): JSX.Element {
  const Icon = sd ? SdIcon : PcIcon
  return (
    <span className="shrink-0 text-brand" title={title}>
      <Icon className="h-4 w-4" />
    </span>
  )
}

/** Monochrome folder icon (Feather-style) — uses `currentColor` so it follows
 *  the button's theme colour instead of the yellow emoji folder. */
function FolderIcon(): JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function Pill({
  color,
  disabled,
  onClick,
  title,
  children
}: {
  color: 'ok' | 'warn' | 'danger' | 'dangerSoft' | 'muted'
  disabled?: boolean
  onClick?: () => void
  title?: string
  children: React.ReactNode
}): JSX.Element {
  const bg = {
    ok: 'bg-ok text-slate-200',
    warn: 'bg-warn text-slate-200',
    danger: 'bg-danger text-slate-200 ring-2 ring-danger/60',
    dangerSoft: 'bg-danger/80 text-slate-200',
    muted: 'bg-panel2 text-slate-200 border border-border2 hover:border-brand'
  }[color]
  return (
    <button
      className={`min-w-[120px] rounded-md px-5 py-2 text-center font-semibold shadow-lg transition hover:opacity-90 disabled:opacity-40 ${bg}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}
