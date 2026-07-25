import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { SlidersIcon } from './icons'

/** Dynamic motor tuning: drag sliders to set max speed ($110+) and acceleration
 *  ($120+) per axis, with a live velocity-profile graph and a Test jog so you can
 *  feel the result. (Motor CURRENT/strength is set on the external driver, not in
 *  software — this board has no Trinamic drivers.) Values are written to the
 *  controller on release, not on every drag, to avoid hammering its flash. */
export function StepperTuning({
  axes,
  vals,
  write,
  onClose
}: {
  axes: string[]
  vals: Record<number, string>
  write: (setting: number, value: string | number) => void
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const connected = useStore((s) => s.connected)
  const num = (n: number): number => {
    const v = parseFloat(vals[n] ?? '')
    return Number.isFinite(v) ? v : 0
  }
  // local working copy (live), seeded from current settings at open
  const [local, setLocal] = useState<Record<number, number>>(() => {
    const o: Record<number, number> = {}
    axes.forEach((_, i) => {
      o[110 + i] = num(110 + i)
      o[120 + i] = num(120 + i)
    })
    return o
  })

  const set = (s: number, v: number): void => setLocal((p) => ({ ...p, [s]: v }))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-8" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-border bg-panel shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold tracking-wider text-brand">
            <SlidersIcon /> {t('ui.tune.title')}
          </span>
          <button className="btn ml-auto text-xs" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          {axes.map((a, i) => {
            const rate = local[110 + i] ?? 0
            const accel = local[120 + i] ?? 0
            return (
              <div key={a} className="rounded-lg border border-border bg-panel2 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-base font-bold text-brand">{a}</span>
                  <VProfile rate={rate} accel={accel} />
                  <div className="ml-auto flex gap-1">
                    <TestBtn label="− test" disabled={!connected} onClick={() => window.recta.jog(a, -20, rate)} />
                    <TestBtn label="test +" disabled={!connected} onClick={() => window.recta.jog(a, 20, rate)} />
                  </div>
                </div>

                <Slider
                  label={t('ui.tune.speed')}
                  unit="mm/min"
                  value={rate}
                  min={100}
                  max={Math.max(10000, Math.ceil((num(110 + i) * 1.5) / 100) * 100)}
                  step={50}
                  onInput={(v) => set(110 + i, v)}
                  onCommit={(v) => write(110 + i, v)}
                />
                <Slider
                  label={t('ui.tune.accel')}
                  unit="mm/s²"
                  value={accel}
                  min={20}
                  max={Math.max(3000, Math.ceil((num(120 + i) * 1.5) / 50) * 50)}
                  step={10}
                  onInput={(v) => set(120 + i, v)}
                  onCommit={(v) => write(120 + i, v)}
                />
              </div>
            )
          })}
        </div>

        <div className="border-t border-border px-4 py-2 font-mono text-[10px] leading-relaxed text-slate-500">
          {t('ui.tune.footer')}
        </div>
      </div>
    </div>
  )
}

function Slider({
  label,
  unit,
  value,
  min,
  max,
  step,
  onInput,
  onCommit
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onInput: (v: number) => void
  onCommit: (v: number) => void
}): JSX.Element {
  const commit = (): void => onCommit(value)
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-slate-400">{label}</span>
        <span className="ml-auto font-mono text-sm font-bold tabular-nums text-slate-100">{Math.round(value)}</span>
        <span className="font-mono text-[10px] text-slate-500">{unit}</span>
      </div>
      <input
        type="range"
        className="w-full accent-brand"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onInput(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
    </div>
  )
}

function TestBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-border2 bg-panel px-2 py-0.5 font-mono text-[11px] text-slate-300 transition hover:border-brand hover:text-brand disabled:opacity-40"
    >
      {label}
    </button>
  )
}

/** Live trapezoidal velocity profile for the slider values. */
function VProfile({ rate, accel }: { rate: number; accel: number }): JSX.Element {
  const w = 64
  const h = 24
  const pad = 2
  const hFrac = Math.min(1, rate / 10000)
  const top = pad + (1 - Math.max(0.06, hFrac)) * (h - 2 * pad)
  const tAccel = accel > 0 ? rate / 60 / accel : 0 // s to reach speed
  const rampFrac = Math.min(1, tAccel / 1) // normalize to ~1s
  const ramp = pad + rampFrac * (w / 2 - pad - 4)
  const pts = `${pad},${h - pad} ${ramp},${top} ${w - ramp},${top} ${w - pad},${h - pad}`
  return (
    <svg width={w} height={h} className="rounded bg-panel" aria-hidden>
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
