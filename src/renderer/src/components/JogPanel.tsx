import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { RT } from '@shared/grbl'
import { fromDisplay, unitLabel } from '../units'
import { clampContinuousJog } from '../jogLimits'
import { parkForAccess, resumeFromPark, goToPark } from '../controlActions'
import { useT, useLabel } from '../i18n'
import { Panel } from './Panel'

const STEPS = [0.1, 1, 10]
const FEED_PRESETS = [500, 1000, 2000, 3000, 4000]
const CONT_DIST = 1000 // mm — large; jog is cancelled on button release
const PARK_HOLD_MS = 700 // press-and-hold time to confirm "go to park" (guards a stray tap)

type Move = { a: string; s: number }

export function JogPanel(): JSX.Element {
  const t = useT()
  const L = useLabel()
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  const sdRunning = useStore((s) => s.sdRunning)
  const base = useStore((s) => (s.status?.state ?? '').split(':')[0])
  // A program is active if we're streaming (job.running), an SD/external run is
  // latched (sdRunning), or the machine is executing/paused (Run/Hold/Door/Home).
  // Covers both app-streamed and SD jobs — and the latch closes the Idle window
  // right after Cycle where a jog used to slip in and derail the program.
  const programActive =
    jobRunning || sdRunning || base === 'Run' || base === 'Hold' || base === 'Door' || base === 'Home'
  // Jog: allowed only when no program is active and not locked in Alarm. 'Idle'
  // and 'Jog' pass (so a hold-jog's pointer-up still fires the cancel); but if a
  // program is latched, even a stray 'Jog' state stays blocked.
  const canJog = connected && !programActive && base !== 'Alarm'
  // Home / Unlock: fine from Idle or Alarm, but never while a program is active.
  const canRecover = connected && !programActive
  // Units are owned by $13 (set in Settings); the Jog panel only reflects it.
  const units = useStore((s) => s.units)
  // for clamping continuous jog to soft-limit travel once homed
  const axesList = useStore((s) => s.info.axes)
  // Rotary axes (A, B, C…) beyond the XYZ pad each get their own jog column, so the
  // panel scales to 3-, 4- and 5-axis machines. The Z + rotary block has a fixed
  // width the Step/Hold toggle mirrors above — floored to 6.25rem so on a 3-axis
  // machine the toggle never collapses to a single Z-wide button (it used to squash
  // both labels into ~48px). Width = Z(3rem) + 3.25rem per rotary column (col + gap).
  const rotary = axesList.filter((a) => a !== 'X' && a !== 'Y' && a !== 'Z')
  const colBlockRem = Math.max(6.25, 3 + 3.25 * rotary.length)
  const mpos = useStore((s) => s.status?.mpos ?? null)
  const travel = useStore((s) => s.travel)
  const homed = useStore((s) => s.homed)
  const softLimits = useStore((s) => s.softLimits)
  const homingDirMask = useStore((s) => s.homingDirMask)
  // step / feed / mode are shared with the keyboard + gamepad layers, so they
  // live in the store's controls (one source of truth for every jog input).
  const { mode, feed, step } = useStore((s) => s.controls)
  const setControls = useStore((s) => s.setControls)

  // one jog: Hold mode sends a large move cancelled on release; Step mode sends
  // a single finite increment (no cancel).
  const doJog = (moves: Move[]): void => {
    if (!canJog) return
    const f = Math.round(fromDisplay(feed || 1000, units))
    // Hold = long continuous move. Clamp to remaining travel ONLY when soft limits
    // are actually enforced (homed + $20 on) — that's exactly when grblHAL would
    // reject an over-travel jog (error:15). Otherwise send the full distance so
    // jogging still works when soft limits are off. Step = the set increment.
    // Both are sent in mm (G21).
    const clamp = homed && softLimits
    const dist =
      mode === 'hold'
        ? clamp
          ? clampContinuousJog(moves, axesList, mpos, travel, homingDirMask, CONT_DIST)
          : CONT_DIST
        : step
    if (dist <= 0) return // already at the soft-limit boundary in this direction
    const parts = moves.map((m) => `${m.a}${m.s * dist}`).join(' ')
    window.recta.send(`$J=G91 G21 ${parts} F${f}`)
  }
  const cancel = (): void => {
    // Only cancel a jog we could actually be running. Chromium still fires
    // pointerenter/leave on a DISABLED button, so hovering a greyed-out arrow
    // during a program would otherwise fire this and send a jog-cancel (0x85) —
    // grblHAL treats that as a feed hold and stops the job. `canJog` is false
    // whenever a program is active, so this guard blocks exactly that case.
    if (canJog) window.recta.realtime(RT.jogCancel)
  }
  // pointer handlers per mode: hold = press/cancel; step = one shot on press
  const press = (moves: Move[]): Record<string, () => void> =>
    mode === 'hold'
      ? { onPointerDown: () => doJog(moves), onPointerUp: cancel, onPointerLeave: cancel }
      : { onPointerDown: () => doJog(moves) }

  // a jog button (cardinal / diagonal)
  const J = (label: string, moves: Move[], extra = ''): JSX.Element => (
    <button
      className={`flex items-center justify-center rounded-md border border-border2 bg-panel2 font-mono text-sm font-bold text-slate-100 transition enabled:hover:border-brand enabled:hover:text-brand enabled:active:bg-border disabled:opacity-40 ${extra || 'h-11 w-12'}`}
      disabled={!canJog}
      {...press(moves)}
    >
      {label}
    </button>
  )
  // A tall jog button for a single linear/rotary axis (Z, A, …).
  const AxBtn = (axis: string, label: string, sign: number): JSX.Element => (
    <button
      className="flex flex-1 w-12 items-center justify-center rounded-md border border-border2 bg-panel2 font-mono text-sm font-bold text-slate-100 transition enabled:hover:border-brand enabled:hover:text-brand enabled:active:bg-border disabled:opacity-40"
      disabled={!canJog}
      {...press([{ a: axis, s: sign }])}
    >
      {label}
    </button>
  )

  return (
    <Panel>
      {/* top row aligned to the jog columns below: step increments over the 3-wide
          XY pad · Step/Hold mode over the Z + A columns · Feed over the action column */}
      <div className="mb-3 flex items-stretch gap-2">
        {/* step increments — span the full XY-pad width (label removed). Disabled in
            Hold mode (a step size is meaningless then); one is selected in Step mode. */}
        <div className="flex h-[27px] w-[9.5rem] shrink-0 overflow-hidden rounded-md border border-border2">
          {STEPS.map((s) => (
            <button
              key={s}
              disabled={mode === 'hold'}
              onClick={() => setControls({ step: s })}
              className={`flex-1 font-mono text-sm transition disabled:opacity-40 ${
                mode === 'step' && step === s
                  ? 'bg-brand text-[#020617]'
                  : 'bg-panel2 text-slate-400 enabled:hover:text-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Step / Hold mode — mirrors the Z + rotary block width below, so the Feed
            box lines up with the Home/action column (both flex-1 start at the same x)
            on any axis count. */}
        <div
          className="flex h-[27px] shrink-0 overflow-hidden rounded-md border border-border2"
          style={{ width: `${colBlockRem}rem` }}
        >
          {(['step', 'hold'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setControls({ mode: m })}
              title={t('ui.controls.modeHint')}
              className={`flex-1 font-mono text-xs transition ${
                mode === m ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-400 hover:text-slate-200'
              }`}
            >
              {L(`ui.controls.mode.${m}`)}
            </button>
          ))}
        </div>

        {/* Feed — one box spanning the Home/action column, labels inside it */}
        <FeedControl />
      </div>

      {/* jog controls — all hold-to-jog */}
      <div className="flex items-stretch gap-2">
        {/* XY pad with diagonals; center = soft reset */}
        <div className="grid grid-cols-3 grid-rows-3 gap-1">
          {J('↖', [{ a: 'X', s: -1 }, { a: 'Y', s: 1 }])}
          {J('Y+', [{ a: 'Y', s: 1 }])}
          {J('↗', [{ a: 'X', s: 1 }, { a: 'Y', s: 1 }])}
          {J('X-', [{ a: 'X', s: -1 }])}
          <button
            title={t('ui.jog.softReset')}
            disabled={!connected}
            onClick={() => window.recta.realtime(RT.softReset)}
            className="flex h-11 w-12 items-center justify-center rounded-md border border-danger/50 bg-panel2 text-lg text-danger transition hover:bg-danger hover:text-white disabled:opacity-40"
          >
            ⟲
          </button>
          {J('X+', [{ a: 'X', s: 1 }])}
          {J('↙', [{ a: 'X', s: -1 }, { a: 'Y', s: -1 }])}
          {J('Y-', [{ a: 'Y', s: -1 }])}
          {J('↘', [{ a: 'X', s: 1 }, { a: 'Y', s: -1 }])}
        </div>

        {/* Z + rotary columns — a fixed-width block the Step/Hold toggle mirrors, so
            the action column (and the Feed box above it) stay aligned on 3-, 4- and
            5-axis machines. Z is always present; each rotary axis (A, B, …) adds a
            w-12 column. On a 3-axis machine the block keeps its 6.25rem floor, leaving
            the (empty) rotary space reserved so nothing shifts. */}
        <div className="flex shrink-0 gap-1" style={{ width: `${colBlockRem}rem` }}>
          <div className="flex w-12 flex-col gap-1">
            {AxBtn('Z', 'Z+', 1)}
            {AxBtn('Z', 'Z-', -1)}
          </div>
          {rotary.map((ax) => (
            <div key={ax} className="flex w-12 flex-col gap-1">
              {AxBtn(ax, `${ax}+`, 1)}
              {AxBtn(ax, `${ax}-`, -1)}
            </div>
          ))}
        </div>

        {/* machine actions: wide Home + Unlock (icon + label), plus a narrow tall
            Park/Resume button (vertical text, Z/A width, like ZERO ALL) on the right. */}
        <div className="flex flex-1 gap-1">
          <div className="flex flex-1 flex-col gap-1">
            <ActionBtn
              icon={<HomeIcon />}
              label={L('ui.jog.home')}
              title={t(homed ? 'ui.jog.homedTitle' : 'ui.jog.homeTitle')}
              disabled={!canRecover}
              onClick={() => window.recta.send('$H')}
              active={homed}
            />
            <ActionBtn
              icon={<UnlockIcon />}
              label={L('ui.jog.unlock')}
              title={t('ui.jog.unlockTitle')}
              disabled={!canRecover}
              onClick={() => window.recta.send('$X')}
            />
          </div>
          <ParkBtn />
        </div>
      </div>
    </Panel>
  )
}

/** A uniform machine-action button (icon + label) for the Jog panel's action
 *  column — Home / Unlock, filling the freed width. `active` recolours it green
 *  as a status light (used by Home when the machine is homed / referenced). */
function ActionBtn({
  icon,
  label,
  title,
  disabled,
  onClick,
  active
}: {
  icon: JSX.Element
  label: string
  title: string
  disabled: boolean
  onClick: () => void
  active?: boolean
}): JSX.Element {
  // green when "on" (e.g. homed), brand otherwise. Kept as a full class swap so
  // Tailwind's JIT keeps both colour sets in the build.
  const accent = active
    ? 'border-emerald-400/60 text-emerald-400 enabled:hover:bg-emerald-400 enabled:hover:text-[#020617]'
    : 'border-brand/50 text-brand enabled:hover:bg-brand enabled:hover:text-[#020617]'
  return (
    <button
      className={`flex flex-1 items-center justify-center gap-2 rounded-md border bg-panel2 font-mono transition disabled:opacity-40 ${accent}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {icon}
      <span className="text-xs">{label}</span>
      {active && <span className="text-[10px] leading-none">●</span>}
    </button>
  )
}

/** Park & Resume: a tall vertical button (stacked letters, like ZERO ALL) filling
 *  the action column. While a job cuts it PARKS (feed-hold → abort to Idle so you can
 *  jog the head free to clear chips); once parked it RESUMES (returns to the stopped
 *  line and continues). Amber while running, green when a resume is pending. */
function ParkBtn(): JSX.Element {
  const t = useT()
  const L = useLabel()
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  const sdRunning = useStore((s) => s.sdRunning)
  const parked = useStore((s) => s.parked)
  const homed = useStore((s) => s.homed)
  const parkPos = useStore((s) => s.parkPos)
  const base = useStore((s) => (s.status?.state ?? '').split(':')[0])
  const [holding, setHolding] = useState(false)

  // Park from a PAUSED job (Hold/Door): a soft-reset abort while actively moving (Run)
  // loses position → alarm, so you must Pause first, then Park.
  const canPark = connected && jobRunning && (base === 'Hold' || base === 'Door')
  // resume only when actually resumable (parked AND back at Idle) — so a lingering
  // park flag during a fresh run still reads/acts as PARK, never a stray resume
  const resumeMode = connected && parked && base === 'Idle'
  // no job → Park is just "go to the saved park spot" (tool changes / setups); needs a
  // saved position and a homed machine (G53 target must be valid)
  const canGoPark =
    connected && !jobRunning && !sdRunning && !parked && base === 'Idle' && homed && parkPos != null
  const enabled = canPark || resumeMode || canGoPark
  const label = (resumeMode ? L('ui.jog.resume') : L('ui.jog.park')).toUpperCase()
  const accent = resumeMode
    ? 'border-emerald-400/60 text-emerald-400 enabled:hover:bg-emerald-400 enabled:hover:text-[#020617]'
    : canGoPark
      ? 'border-amber-400/60 text-amber-400' // hold-to-go: the rising fill is the feedback, no hover flood
      : 'border-amber-400/60 text-amber-400 enabled:hover:bg-amber-400 enabled:hover:text-[#020617]'

  // goToPark MOVES the head across the table the instant it fires, so — unlike Park
  // (from a paused job) and Resume, which are deliberate steps in a job flow — it must
  // NOT act on a stray tap. Gate it behind a press-and-hold: a rising amber fill shows
  // the hold progressing, and only a full hold (PARK_HOLD_MS) triggers the move.
  const holdMode = canGoPark
  const handlers = holdMode
    ? {
        onPointerDown: () => setHolding(true),
        onPointerUp: () => setHolding(false),
        onPointerLeave: () => setHolding(false)
      }
    : { onClick: () => (resumeMode ? resumeFromPark() : parkForAccess()) }

  return (
    <button
      disabled={!enabled}
      title={t(resumeMode ? 'ui.jog.resumeTitle' : holdMode ? 'ui.jog.goToParkTitle' : 'ui.jog.parkTitle')}
      className={`relative flex w-12 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border bg-panel2 font-mono text-sm font-bold uppercase leading-tight transition disabled:opacity-40 ${accent}`}
      {...handlers}
    >
      {holdMode && (
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-amber-400/25"
          style={{
            height: holding ? '100%' : '0%',
            transition: `height ${holding ? PARK_HOLD_MS : 140}ms linear`
          }}
          onTransitionEnd={() => {
            // fires at full height only while still held → confirmed hold. On release the
            // fill shrinks back to 0 with holding=false, so that transition is ignored.
            if (holding) {
              goToPark()
              setHolding(false)
            }
          }}
        />
      )}
      <span className="relative flex flex-col items-center gap-1">
        {label.split('').map((ch, i) => (
          <span key={i}>{ch}</span>
        ))}
      </span>
    </button>
  )
}

/** Feed control: a box you can type into (up to 4 digits) with a real dropdown
 *  of preset rates — one control, fills the action-column width, unit after it. */
function FeedControl(): JSX.Element {
  const t = useT()
  const L = useLabel()
  const units = useStore((s) => s.units)
  const feed = useStore((s) => s.controls.feed)
  const setControls = useStore((s) => s.setControls)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative flex h-[27px] min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border2 bg-panel2 px-2">
      <span className="shrink-0 font-mono text-[11px] text-slate-500">{L('ui.jog.feed')}</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-center font-mono text-sm text-slate-100 outline-none"
        type="text"
        inputMode="numeric"
        value={feed}
        onChange={(e) => setControls({ feed: Math.min(9999, Number(e.target.value.replace(/\D/g, '')) || 0) })}
      />
      <span className="shrink-0 font-mono text-[10px] text-slate-600">{unitLabel(units)}/min</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="shrink-0 text-slate-500 transition hover:text-slate-200"
        title={t('ui.jog.feed')}
      >
        ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-full overflow-hidden rounded-md border border-border2 bg-panel shadow-lg">
          {FEED_PRESETS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setControls({ feed: f })
                setOpen(false)
              }}
              className={`block w-full px-2 py-1 text-center font-mono text-xs transition hover:bg-panel2 ${
                f === feed ? 'text-brand' : 'text-slate-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Monochrome line icons (Feather-style). They use `currentColor`, so they take
 *  the button's text colour and flip automatically on hover. */
function HomeIcon(): JSX.Element {
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
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function UnlockIcon(): JSX.Element {
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
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  )
}
