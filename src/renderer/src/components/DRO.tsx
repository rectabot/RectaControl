import { useState } from 'react'
import { useStore } from '../store'
import { Panel } from './Panel'
import { Overrides } from './Overrides'
import { fmtPos } from '../units'
import { useT, useLabel } from '../i18n'

const DEFAULT_AXES = ['X', 'Y', 'Z']
const WCS_LIST = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59']

export function DRO(): JSX.Element {
  const t = useT()
  const L = useLabel()
  const status = useStore((s) => s.status)
  const units = useStore((s) => s.units)
  const info = useStore((s) => s.info)
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  const sdRunning = useStore((s) => s.sdRunning)
  const wcs = useStore((s) => s.wcs)
  const setWcs = useStore((s) => s.setWcs)
  const setOffsetsOpen = useStore((s) => s.setOffsetsOpen)

  // Zeroing (G10 L20), Go-To-Zero rapids (G0) and WCS changes are only accepted
  // by grblHAL when the machine is Idle — and only make sense then. Clicking them
  // mid-job injects commands into the running stream and corrupts the program
  // (moves the work origin / WCS under the toolpath → the job's own arcs then
  // fail with error:34). In Alarm they're rejected as "locked" (error:9). So gate
  // every DRO action strictly on "ready" = connected + Idle + no job streaming.
  const base = (status?.state ?? '').split(':')[0]
  const ready = connected && !jobRunning && !sdRunning && base === 'Idle'

  /** Activate a work coordinate system (G54–G59). */
  const selectWcs = (g: string): void => {
    if (!ready) return
    setWcs(g)
    window.recta.send(g)
  }

  /** Zero the given axes into the active WCS (G10 L20 via setZero). */
  const zero = (axes: string[]): void => {
    if (ready) axes.forEach((a) => window.recta.setZero(a, 0))
  }

  /** Return to work zero. Retract Z fully to the machine top (G53 Z0) BEFORE the
   *  XY rapid so the tool never drags across the part. */
  const goToZero = (): void => {
    if (!ready) return
    window.recta.send('G53 G0 Z0')
    window.recta.send('G90 G0 X0 Y0')
  }

  /** Rapid a single axis to its work zero (active WCS). */
  const goAxisZero = (axis: string): void => {
    if (ready) window.recta.send(`G90 G0 ${axis}0`)
  }

  /** Rapid a single axis to a typed target position (active WCS). */
  const goAxisPos = (axis: string, value: number): void => {
    if (ready) window.recta.send(`G90 G0 ${axis}${value}`)
  }

  // work position is primary; machine position shown small underneath
  const pos = status?.wpos ?? null
  const other = status?.mpos ?? null

  // Axes follow the controller's reported set ([AXS:n:XYZAB…]); stacked one per row.
  const axes = info.axes.length ? info.axes : DEFAULT_AXES

  return (
    <Panel>
      {/* WCS quick-select (G54–G59) — mirrors the axis-row columns for symmetry:
          "WCS" (help) aligns with Zero-all, the G54–G59 strip spans X0…X, and the
          Offsets ⊞ aligns with Go-to-zero. */}
      <div className="mb-3 flex h-[27px] items-stretch gap-2">
        <WcsHelp />
        <div className="flex flex-1 overflow-hidden rounded-md border border-border2">
          {WCS_LIST.map((g) => (
            <button
              key={g}
              onClick={() => selectWcs(g)}
              disabled={!ready}
              className={`flex-1 px-2 py-1 font-mono text-xs transition disabled:opacity-40 ${
                wcs === g ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-400 hover:text-slate-200'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
        <button
          className="flex w-11 shrink-0 items-center justify-center rounded-md border border-border2 text-xs text-slate-400 transition hover:border-brand hover:text-brand disabled:opacity-40"
          onClick={() => setOffsetsOpen(true)}
          disabled={!connected}
          title={t('ui.offsets.open')}
        >
          ⊞
        </button>
      </div>

      <div className="flex items-stretch gap-2">
        {/* Zero-all — vertical button spanning every axis row, first on the left */}
        <VBtn
          label={L('ui.dro.zeroAll')}
          title={t('ui.dro.zeroAllTitle')}
          disabled={!ready}
          onClick={() => zero(axes)}
        />

        {/* per-axis rows */}
        <div className="flex flex-1 flex-col gap-1.5">
          {axes.map((axis, i) => (
            <AxisCell
              key={axis}
              axis={axis}
              primary={pos ? fmtPos(pos[i], units) : '—'}
              secondary={other ? fmtPos(other[i], units) : ''}
              enabled={ready}
              onZero={() => zero([axis])}
              onGoZero={() => goAxisZero(axis)}
              onGoTo={(v) => goAxisPos(axis, v)}
            />
          ))}
        </div>

        {/* Go-to-zero — identical vertical button, right after the value boxes */}
        <VBtn
          label={L('ui.jog.gotoZero')}
          title={t('ui.jog.gotoZeroTitle')}
          disabled={!ready}
          onClick={goToZero}
        />
      </div>

      <div className="mt-3">
        <Overrides />
      </div>
    </Panel>
  )
}

/** One DRO axis: a per-axis zero button (same height as the field), then the
 *  position field with the axis letter and value inside it (secondary reading
 *  tucked underneath). Click ⌀0 = zero into the active WCS (G10 L20). */
function AxisCell({
  axis,
  primary,
  secondary,
  enabled,
  onZero,
  onGoZero,
  onGoTo
}: {
  axis: string
  primary: string
  secondary: string
  enabled: boolean
  onZero: () => void
  onGoZero: () => void
  onGoTo: (value: number) => void
}): JSX.Element {
  const t = useT()
  const L = useLabel()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const btn =
    'flex w-11 shrink-0 items-center justify-center rounded-md border border-border2 bg-panel2 font-mono text-sm font-bold text-slate-300 transition enabled:hover:border-brand enabled:hover:text-brand disabled:opacity-40'

  const startEdit = (): void => {
    if (!enabled) return
    setDraft(primary.replace(/[^\d.-]/g, ''))
    setEditing(true)
  }
  const commit = (): void => {
    const v = parseFloat(draft)
    if (Number.isFinite(v)) onGoTo(v)
    setEditing(false)
  }

  return (
    <div className="flex items-stretch gap-2">
      {/* set this axis to zero (X0/Y0/Z0/A0) */}
      <button className={btn} disabled={!enabled} onClick={onZero} title={t('ui.dro.zeroTitle')}>
        {axis}0
      </button>
      <div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-base px-2 py-1">
        {/* axis label = GO TO button: click to type a target position, Enter to move.
            shrink-0 so the freed space always goes to the number field (keeps a few
            px of slack, else a full-width value like -1000.000 clips its last digit
            when the caret moves to the front and the browser nudges the scroll). */}
        <button
          className="flex shrink-0 items-baseline gap-1 rounded px-1 py-0.5 transition enabled:hover:bg-panel2 disabled:opacity-40"
          disabled={!enabled}
          onClick={startEdit}
          title={t('ui.dro.goToTitle')}
        >
          <span className="font-mono text-lg font-bold text-brand">{axis}</span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">{L('ui.dro.goToLabel')}</span>
        </button>
        {/* fixed two-line layout so the box height never changes on edit */}
        <div className="flex flex-1 flex-col items-end leading-none">
          {editing ? (
            <input
              autoFocus
              className="h-[1.75rem] w-full bg-transparent p-0 text-right font-mono text-2xl font-bold leading-none tabular-nums text-brand outline-none"
              value={draft}
              inputMode="decimal"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={() => setEditing(false)}
            />
          ) : (
            <span className="flex h-[1.75rem] items-center font-mono text-2xl font-bold tabular-nums text-slate-100">
              {primary}
            </span>
          )}
          <span className="mt-0.5 font-mono text-[10px] text-slate-500">{secondary || ' '}</span>
        </div>
      </div>
      {/* send this axis to its work zero (X/Y/Z/A) */}
      <button className={btn} disabled={!enabled} onClick={onGoZero} title={t('ui.dro.goAxisTitle')}>
        {axis}
      </button>
    </div>
  )
}

/** A tall cyan-outlined action button with its label stacked one letter per line,
 *  one column per word (ZERO / ALL · GO / TO / ZERO). Shared by both DRO actions
 *  so they are pixel-identical. */
function VBtn({
  label,
  title,
  disabled,
  onClick
}: {
  label: string
  title: string
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className="flex w-11 shrink-0 flex-col items-center justify-center gap-2 rounded-md border border-brand/50 bg-panel2 font-mono text-sm font-bold uppercase text-brand transition enabled:hover:bg-brand enabled:hover:text-[#020617] disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {label
        .toUpperCase()
        .split(/\s+/)
        .map((word, wi) => (
          <span key={wi} className="flex flex-col items-center leading-tight">
            {word.split('').map((ch, ci) => (
              <span key={ci}>{ch}</span>
            ))}
          </span>
        ))}
    </button>
  )
}

/** The "WCS" label doubles as the help trigger — clicking it opens a popover
 *  explaining work coordinate systems (G54–G59). Same w-11 footprint as Zero-all. */
function WcsHelp(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative shrink-0">
      <button
        className="flex h-full w-11 items-center justify-center rounded-md border border-border2 font-mono text-xs font-bold text-slate-400 transition hover:border-brand hover:text-brand"
        onClick={() => setOpen((o) => !o)}
        title={t('ui.wcs.q')}
      >
        WCS
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-border bg-panel p-3 text-xs leading-relaxed text-slate-300 shadow-glow">
            <div className="mb-1 font-display text-sm font-bold text-brand">{t('ui.wcs.title')}</div>
            <p className="mb-2">{t('ui.wcs.p1')}</p>
            <p className="mb-2">{t('ui.wcs.p2')}</p>
            <p className="text-slate-500">{t('ui.wcs.p3')}</p>
          </div>
        </>
      )}
    </div>
  )
}

