import { useEffect, useState } from 'react'
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
  const wcsVariant = useStore((s) => s.wcsVariant)
  const setWcsVariant = useStore((s) => s.setWcsVariant)

  // If an extra system is active but the strip isn't showing it — typed in the
  // terminal, or left active by a program — adopt the suffix so the button reads
  // (and highlights as) the system the machine is really in. Without this the strip
  // would show no selection at all while G59.2 was active.
  useEffect(() => {
    if (wcs.startsWith('G59.') && wcs.slice(3) !== wcsVariant) setWcsVariant(wcs.slice(3))
  }, [wcs, wcsVariant, setWcsVariant])

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

  // work position is primary; machine position shown small beside the axis letter
  const pos = status?.wpos ?? null
  const other = status?.mpos ?? null

  // Axes follow the controller's reported set ([AXS:n:XYZAB…]); stacked one per row.
  const axes = info.axes.length ? info.axes : DEFAULT_AXES

  return (
    <Panel>
      {/* WCS quick-select. "WCS" opens the offsets table (where the explanation and the
          full editor live) and lines up with Zero-all; the strip then runs to the panel
          edge — no orphan slot on the right, which also gives the cells room to breathe.
          The G59 cell splits in two on boards that have G59.1–G59.3, so the variant is
          picked right where it applies instead of from across the row. */}
      <div className="mb-3 flex h-[27px] items-stretch gap-2">
        <button
          className="flex w-11 shrink-0 items-center justify-center rounded-md border border-border2 font-mono text-xs font-bold text-slate-400 transition hover:border-brand hover:text-brand disabled:opacity-40"
          onClick={() => setOffsetsOpen(true)}
          disabled={!connected}
          title={t('ui.offsets.open')}
        >
          WCS
        </button>
        {/* grid, not flex: six EXACTLY equal columns. With flex the split G59 cell has
            a wider min-content than "G54" and the row stops dividing evenly.
            No overflow-hidden either — the variant menu has to escape the strip, so
            the end cells round their own outer corners instead. */}
        <div className="grid flex-1 grid-cols-6 rounded-md border border-border2">
          {WCS_LIST.slice(0, 5).map((g, i) => (
            <button
              key={g}
              onClick={() => selectWcs(g)}
              disabled={!ready}
              className={`min-w-0 px-1 py-1 font-mono text-xs transition disabled:opacity-40 ${
                i === 0 ? 'rounded-l-md' : ''
              } ${wcs === g ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-400 hover:text-slate-200'}`}
            >
              {g}
            </button>
          ))}
          <G59Cell ready={ready} onSelect={selectWcs} />
        </div>
      </div>

      <div className="flex items-stretch gap-2">
        {/* Zero-all — vertical button spanning every axis row, first on the left */}
        <VBtn
          label={L('ui.dro.zeroAll')}
          title={t('ui.dro.zeroAllTitle')}
          disabled={!ready}
          onClick={() => zero(axes)}
        />

        {/* Per-axis rows, at their own size and no more. A row is identical on
            three axes and on four; the block is simply as tall as the rows it has,
            and the two action buttons beside it take that same height. So a 3-axis
            machine gets a shorter, tighter panel instead of one row of empty space
            held open for an axis it does not have. */}
        <div className="flex flex-1 flex-col gap-1.5">
          {/* One row per axis the controller CLAIMS in $I; the numbers come from
              status reports, and the two can disagree for a moment (a report that
              arrives short, a board rebooting mid-line). Such an axis shows a dash
              — reaching past the end of that array used to take the whole UI down. */}
          {axes.map((axis, i) => (
            <AxisCell
              key={axis}
              axis={axis}
              primary={pos?.[i] != null ? fmtPos(pos[i], units) : '—'}
              secondary={other?.[i] != null ? fmtPos(other[i], units) : ''}
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

/** One DRO axis: a per-axis zero button, the position field, and a go-to-zero button.
 *  Both buttons carry the axis letter, so the field between them does not — it is
 *  the machine position small on the left and the work position large on the right,
 *  and all the width it can spare belongs to the number.
 *
 *  The machine position used to sit UNDER the work position, which cost the row a
 *  second line and pushed the number people actually read off centre. It moved onto
 *  the same line at the size it already had — it is a reference, not a reading.
 *
 *  That label was also the way to type a target, which is why it is not simply gone:
 *  the number itself takes that job on a double-click. A single click is too easy to
 *  land on by accident on a control that sends the machine somewhere. */
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
        {/* The machine position, and nothing else. The axis letter was in here too,
            which made three places saying X on one row — the ⌀0 button, the go-to
            button, and this. The buttons that DO something keep the letter; the box
            gives the space to the number. shrink-0 so the freed width always goes to
            the number field (keeps a few px of slack, else a full-width value like
            -1000.000 clips its last digit when the caret moves to the front and the
            browser nudges the scroll). */}
        <span className="shrink-0 px-1 font-mono text-xs tabular-nums text-slate-500" title={t('ui.dro.machineTitle')}>
          {secondary || '—'}
        </span>
        {/* Exactly the height the two-line layout came to, so the row is as tall as it
            ever was and the box does not change size on edit — the work position now
            sits in the middle of it, level with the axis letter, instead of riding
            above a second reading. */}
        <div className="flex h-10 flex-1 items-center justify-end leading-none">
          {editing ? (
            <input
              autoFocus
              className="w-full bg-transparent p-0 text-right font-mono text-2xl font-bold leading-none tabular-nums text-brand outline-none"
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
            <span
              className={`select-none font-mono text-2xl font-bold tabular-nums text-slate-100 ${enabled ? 'cursor-pointer' : ''}`}
              onDoubleClick={startEdit}
              title={t('ui.dro.goToTitle')}
            >
              {primary}
            </span>
          )}
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
 *  so they are pixel-identical.
 *
 *  It takes the height of the axis block beside it, which is however many axes the
 *  machine has. GO TO ZERO is the tallest label — eight letters and two gaps — so
 *  it is the one that decides whether a three-row block is enough. `overflow-hidden`
 *  is the floor: if a UI scale ever makes the letters outgrow the button, they get
 *  clipped inside it rather than spilling over the panel around it. */
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
      className="flex w-11 shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-brand/50 bg-panel2 font-mono text-sm font-bold uppercase text-brand transition enabled:hover:bg-brand enabled:hover:text-[#020617] disabled:opacity-40"
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

/**
 * The last cell of the WCS strip. On a board that only has six systems it is an
 * ordinary G59 button. On a board that reports G59.1–G59.3 it SPLITS in two, reading
 * as one button — `G59` on the left, the variant on the right:
 *
 *     ┌──────┬────┐
 *     │ G59  │ .2 │   left half → plain G59 · right half → pick .1/.2/.3
 *     └──────┴────┘
 *
 * Both halves activate immediately. Switching systems is the strip's entire job, so a
 * pick IS the switch — and the left half doubles as the way back to plain G59, which
 * is why the menu carries no "none" entry. Idle-gated like every other command.
 */
function G59Cell({ ready, onSelect }: { ready: boolean; onSelect: (g: string) => void }): JSX.Element {
  const t = useT()
  const wcs = useStore((s) => s.wcs)
  const extraWcs = useStore((s) => s.extraWcs)
  const wcsVariant = useStore((s) => s.wcsVariant)
  const setWcsVariant = useStore((s) => s.setWcsVariant)
  const [open, setOpen] = useState(false)

  const label = `G59${wcsVariant}`
  const active = wcs === label
  const skin = active ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-400 hover:text-slate-200'

  // six-system board: nothing to split
  if (!extraWcs.length)
    return (
      <button
        onClick={() => onSelect('G59')}
        disabled={!ready}
        className={`min-w-0 rounded-r-md px-1 py-1 font-mono text-xs transition disabled:opacity-40 ${
          wcs === 'G59' ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-400 hover:text-slate-200'
        }`}
      >
        G59
      </button>
    )

  /** Back to the plain sixth system: drop the suffix and switch to it. */
  const plain = (): void => {
    setWcsVariant('')
    onSelect('G59')
  }
  /** Snap a suffix on and switch straight to that system. */
  const pick = (v: string): void => {
    setWcsVariant(v)
    setOpen(false)
    onSelect(`G59${v}`)
  }

  return (
    // the cell keeps its one-sixth column and splits INSIDE it, so the strip stays even
    <div className="relative flex min-w-0">
      <button
        onClick={plain}
        disabled={!ready}
        className={`min-w-0 flex-1 py-1 pl-0.5 font-mono text-xs transition disabled:opacity-40 ${skin}`}
        title={t('ui.dro.wcsVariantTitle')}
      >
        G59
      </button>
      {/* hairline seam, not a gap — the two halves have to read as one button */}
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!ready}
        className={`shrink-0 rounded-r-md border-l border-black/20 py-1 pl-1 pr-1.5 font-mono text-[11px] transition disabled:opacity-40 ${skin} ${
          wcsVariant ? '' : 'opacity-70'
        }`}
        title={t('ui.dro.wcsVariantTitle')}
      >
        {wcsVariant || '.x'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 flex w-20 flex-col overflow-hidden rounded-md border border-border bg-panel shadow-glow">
            {extraWcs.map((g) => {
              const v = g.slice(3) // 'G59.2' → '.2'
              return (
                <button
                  key={g}
                  onClick={() => pick(v)}
                  className={`px-2 py-1.5 text-left font-mono text-xs transition hover:bg-panel2 ${
                    wcs === g ? 'text-brand' : 'text-slate-300'
                  }`}
                >
                  {g}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

