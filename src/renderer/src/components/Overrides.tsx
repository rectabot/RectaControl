import { useState } from 'react'
import { useStore } from '../store'
import { RT } from '@shared/grbl'
import { useT, useLabel } from '../i18n'

export function Overrides(): JSX.Element {
  const L = useLabel()
  const connected = useStore((s) => s.connected)
  const status = useStore((s) => s.status)
  const [feedOv, rapidOv, spindleOv] = useStore((s) => s.overrides)

  const rt = (byte: number): void => {
    if (connected) window.recta.realtime(byte)
  }
  const applySteps = (current: number, target: number, plus10: number, minus10: number): void => {
    if (!connected) return
    const diff = Math.round((target - current) / 10)
    const byte = diff > 0 ? plus10 : minus10
    for (let i = 0; i < Math.abs(diff); i++) rt(byte)
  }

  return (
    <div className="space-y-2">
      {/* two small boxes side by side */}
      <div className="grid grid-cols-2 gap-2">
        <Box
          label={L('ui.ov.feed')}
          value={feedOv}
          actual={`${status?.feed ?? 0} mm/min`}
          disabled={!connected}
          onCommit={(t) => applySteps(feedOv, t, RT.feedPlus10, RT.feedMinus10)}
          onReset={() => rt(RT.feed100)}
        />
        <Box
          label={L('ui.ov.spindle')}
          value={spindleOv}
          actual={`${status?.spindle ?? 0} / ${status?.spindleActual ?? 0} rpm`}
          disabled={!connected}
          onCommit={(t) => applySteps(spindleOv, t, RT.spindlePlus10, RT.spindleMinus10)}
          onReset={() => rt(RT.spindle100)}
        />
      </div>

      {/* rapid — mirrors the WCS strip exactly (w-11 label · bordered preset strip ·
          w-11 value) with items-stretch, so it's the same height for symmetry */}
      <div className="flex h-[27px] items-stretch gap-2">
        <div className="flex w-11 shrink-0 items-center justify-center rounded-md border border-border2 font-mono text-xs text-slate-400">
          {L('ui.ov.rapid')}
        </div>
        <div className="flex flex-1 overflow-hidden rounded-md border border-border2">
          {(
            [
              [25, RT.rapid25],
              [50, RT.rapid50],
              [100, RT.rapid100]
            ] as const
          ).map(([p, b]) => (
            <button
              key={p}
              disabled={!connected}
              onClick={() => rt(b)}
              className={`flex-1 px-2 py-1 font-mono text-xs transition disabled:opacity-40 ${
                rapidOv === p ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-400 hover:text-slate-200'
              }`}
            >
              {p}%
            </button>
          ))}
        </div>
        <div className="flex w-11 shrink-0 items-center justify-center rounded-md border border-border2 font-mono text-xs tabular-nums text-slate-300">
          {rapidOv}%
        </div>
      </div>
    </div>
  )
}

function Box({
  label,
  value,
  actual,
  disabled,
  onCommit,
  onReset
}: {
  label: string
  value: number
  actual: string
  disabled: boolean
  onCommit: (target: number) => void
  onReset: () => void
}): JSX.Element {
  const t = useT()
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value
  const commit = (): void => {
    if (drag != null) {
      onCommit(drag)
      setDrag(null)
    }
  }
  return (
    <div className="rounded-md border border-border bg-panel2 px-2.5 py-1.5">
      {/* row 1: reset pill (label + ↻, resets to 100%) · live reading on the right */}
      <div className="flex items-center justify-between gap-2">
        <button
          className="flex shrink-0 items-center gap-1 rounded-md bg-brand px-2 py-1 font-mono text-xs font-semibold text-[#020617] transition hover:opacity-90 disabled:opacity-40"
          disabled={disabled}
          onClick={onReset}
          title={t('ui.ov.resetTitle')}
        >
          {label}
          <ResetIcon />
        </button>
        <span className="min-w-0 truncate whitespace-nowrap font-mono text-xs font-semibold tabular-nums text-slate-100">
          {actual}
        </span>
      </div>
      {/* row 2: current override % · slider filling the rest */}
      <div className="mt-1.5 flex items-center gap-2">
        <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-brand">{shown}%</span>
        <input
          type="range"
          min={10}
          max={200}
          step={10}
          value={shown}
          disabled={disabled}
          onChange={(e) => setDrag(Number(e.target.value))}
          onMouseUp={commit}
          onTouchEnd={commit}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-base accent-brand disabled:opacity-40"
        />
      </div>
    </div>
  )
}

/** Circular-arrow reset glyph inside the label pill (↻), matching currentColor. */
function ResetIcon(): JSX.Element {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}
