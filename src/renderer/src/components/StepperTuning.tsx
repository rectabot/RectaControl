import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { SlidersIcon } from './icons'

/** How fast each kind of drive can sensibly be pushed. A guardrail, not a target:
 *  a lead screw whips at speed (and worse the longer it is), a belt stretches, a
 *  rack and pinion has neither problem. Rotary is °/min. */
const MECH_CAP: Record<string, number> = { leadscrew: 10000, belt: 20000, rack: 30000, rotary: 36000 }

/** Motor rpm past which a 1.8° stepper has given up most of its torque. A rule of
 *  thumb for direct drive at typical hobby voltages — worth a warning colour, never
 *  a hard limit, because the real number depends on the motor, the driver and the
 *  supply voltage. */
const RPM_SOFT = 1200

/** Shortest run-up worth allowing. Acceleration has no clean formula — it depends on
 *  moving mass and motor torque, neither of which the app knows — but it does have a
 *  sane relation to the axis's own top speed: reaching full speed in under this many
 *  seconds is not something a stepper machine does, so `a_max = v_max / MIN_RAMP_S`
 *  gives the slider a ceiling that moves with the speed instead of a magic number. */
const MIN_RAMP_S = 0.05

/**
 * The hard electrical ceiling, in mm/min (or °/min): one step needs at least
 * `$0 + 2` µs, so the step rate can never exceed 1e6/($0+2) Hz — and the feed that
 * produces is that divided by steps/mm.
 *
 * This is the firmware's own criterion (grbl/settings.c `validate_pulse_width`) —
 * but note that check is COMMENTED OUT in this build: the board will happily accept
 * a `$110` it cannot actually step, and then silently drop steps mid-cut. So this
 * guard exists only here, which is exactly why it is worth having.
 */
function stepRateCap(pulseUs: number, stepsPerMm: number): number {
  if (!(pulseUs > 0) || !(stepsPerMm > 0)) return Infinity
  return (60 * 1e6) / ((pulseUs + 2) * stepsPerMm)
}

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
  const axisMech = useStore((s) => s.axisMech)
  const setAxisMech = useStore((s) => s.setAxisMech)
  const axisPerRev = useStore((s) => s.axisPerRev)
  const setAxisPerRev = useStore((s) => s.setAxisPerRev)
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
        className="flex max-h-full w-full max-w-3xl flex-col rounded-lg border border-border bg-panel shadow-glow"
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

        {/* two axes per row (X Y / Z A) — the whole machine fits on one screen, so
            you compare axes side by side instead of scrolling between them */}
        <div className="grid grid-cols-2 gap-3 overflow-y-auto p-4">
          {axes.map((a, i) => {
            const rate = local[110 + i] ?? 0
            const accel = local[120 + i] ?? 0
            // A/B/C are rotary — their $110+ is degrees per minute, not mm
            const rotary = /^[ABC]$/.test(a)
            const mech = axisMech[i] ?? (rotary ? 'rotary' : undefined)
            const mechCap = mech ? MECH_CAP[mech] ?? Infinity : Infinity
            const stepCap = stepRateCap(num(0), num(100 + i))
            const known = Math.min(mechCap, stepCap)
            // settings not read yet (no $0/$100, no mechanism) → keep the old
            // open-ended scale rather than inventing a ceiling out of nothing
            const cap = Number.isFinite(known) ? known : Math.max(10000, num(110 + i) * 1.5)
            // never let the slider hide a value the controller already holds — an
            // out-of-range setting must stay visible (and gets called out) rather
            // than be silently rescaled away
            const sliderMax = Math.max(Math.round(cap), Math.ceil(num(110 + i)))
            const overCap = rate > cap
            const limit = !Number.isFinite(known)
              ? ''
              : overCap
                ? t('ui.tune.limitOver', { v: Math.round(cap) })
                : stepCap < mechCap
                  ? t('ui.tune.limitSteps', { v: Math.round(cap) })
                  : t('ui.tune.limitMech', { v: Math.round(cap) })
            // acceleration ceiling follows the speed ceiling (see MIN_RAMP_S)
            const accelCap = Number.isFinite(cap) ? cap / 60 / MIN_RAMP_S : 3000
            const accelMax = Math.max(Math.round(accelCap), Math.ceil(num(120 + i)))
            const accelOver = accel > accelCap
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

                {/* What drives this axis. It lives HERE, next to the slider it caps,
                    and not only in the steps calculator — an axis whose steps/mm is
                    already correct should never have to be re-calculated just to
                    tell the app it runs on a lead screw. Set once per machine. */}
                {!rotary && (
                  <div className="mb-1.5 flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 font-mono text-[10px] text-slate-500">{t('ui.calc.mech')}</span>
                    {(['leadscrew', 'belt', 'rack'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setAxisMech(i, m)}
                        title={`${MECH_CAP[m]} mm/min`}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                          mech === m
                            ? 'border-brand bg-brand/15 text-brand'
                            : 'border-border2 text-slate-400 hover:border-brand hover:text-brand'
                        }`}
                      >
                        {t(`ui.calc.mech.${m}`)}
                      </button>
                    ))}
                  </div>
                )}

                {/* Travel per motor TURN — a 1605 screw straight on the shaft is 5.
                    Spelled out in full: sitting next to a "test 20 mm" button, a bare
                    "mm/o" reads as a jog distance. Optional — leave it empty and the
                    rpm readout simply stays away. */}
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] text-slate-500">{t('ui.tune.perRev')}</span>
                  <input
                    className="input !px-1.5 !py-0.5 w-14 text-center font-mono text-[10px]"
                    value={axisPerRev[i] ?? ''}
                    inputMode="decimal"
                    placeholder="—"
                    title={t('ui.tune.perRevTitle')}
                    onChange={(e) => setAxisPerRev(i, parseFloat(e.target.value) || 0)}
                  />
                  <span className="font-mono text-[10px] text-slate-500">{rotary ? '°' : 'mm'}</span>
                  {/* most machines are built the same on every linear axis — one click
                      instead of typing the same number three times */}
                  {!rotary && (axisPerRev[i] ?? 0) > 0 && (
                    <button
                      className="rounded border border-border2 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 transition hover:border-brand hover:text-brand"
                      title={t('ui.tune.applyAllTitle')}
                      onClick={() =>
                        axes.forEach((ax, j) => {
                          if (/^[ABC]$/.test(ax) || j === i) return // rotary is a different animal
                          setAxisPerRev(j, axisPerRev[i])
                          if (mech) setAxisMech(j, mech)
                        })
                      }
                    >
                      {t('ui.tune.applyAll')}
                    </button>
                  )}
                </div>

                <Slider
                  label={t('ui.tune.speed')}
                  unit={rotary ? '°/min' : 'mm/min'}
                  value={rate}
                  min={100}
                  max={sliderMax}
                  step={50}
                  note={limit}
                  warn={overCap}
                  onInput={(v) => set(110 + i, v)}
                  onCommit={(v) => write(110 + i, v)}
                />
                <Slider
                  label={t('ui.tune.accel')}
                  unit={rotary ? '°/s²' : 'mm/s²'}
                  value={accel}
                  min={20}
                  max={accelMax}
                  step={10}
                  note={t('ui.tune.limitAccel', { v: Math.round(accelCap) })}
                  warn={accelOver}
                  onInput={(v) => set(120 + i, v)}
                  onCommit={(v) => write(120 + i, v)}
                />

                {/* What the two sliders actually mean together. Speed and acceleration
                    are only useful as a PAIR: a top speed you need 28 mm of runway to
                    reach is fiction on short segments. All of it is plain arithmetic —
                    the one thing it cannot know is how much torque the motor has left
                    at that speed, which is what the Test buttons are for. */}
                <Derived
                  rate={rate}
                  accel={accel}
                  stepsPerMm={num(100 + i)}
                  pulseUs={num(0)}
                  perRev={axisPerRev[i] ?? 0}
                  rotary={rotary}
                />
              </div>
            )
          })}
        </div>

        <div className="border-t border-border px-4 py-2 font-mono text-[10px] leading-relaxed text-slate-500">
          {t('ui.tune.footer')}
          <span className="mt-1 block text-slate-600">{t('ui.tune.vector')}</span>
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
  note,
  warn,
  onInput,
  onCommit
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  /** why the scale ends where it does — shown under the track */
  note?: string
  /** the value is past what the machine can do: colour it, don't clamp it */
  warn?: boolean
  onInput: (v: number) => void
  onCommit: (v: number) => void
}): JSX.Element {
  const commit = (): void => onCommit(value)
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-slate-400">{label}</span>
        <span
          className={`ml-auto font-mono text-sm font-bold tabular-nums ${warn ? 'text-warn' : 'text-slate-100'}`}
        >
          {Math.round(value)}
        </span>
        <span className="font-mono text-[10px] text-slate-500">{unit}</span>
      </div>
      <input
        type="range"
        className={`w-full ${warn ? 'accent-warn' : 'accent-brand'}`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onInput(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      {/* the ends of the scale, spelled out — a bare track gives no sense of range */}
      <div className="flex items-baseline gap-2 font-mono text-[9px] leading-none text-slate-600">
        <span className="tabular-nums">{min}</span>
        {note && (
          <span className={`flex-1 truncate text-center ${warn ? 'text-warn' : ''}`} title={note}>
            {note}
          </span>
        )}
        <span className="ml-auto tabular-nums">{Math.round(max)}</span>
      </div>
    </div>
  )
}

/**
 * The consequences of the two sliders, as arithmetic:
 *
 *   ramp time      t = v / a
 *   ramp distance  d = v² / 2a          (the runway needed to reach v)
 *   shortest full-speed move = 2d       (accelerate up, decelerate down)
 *   step rate      f = v · steps_per_mm / 60,  ceiling 1e6 / ($0 + 2)
 *
 * The useful part is that `a` sets the FORCE the motor must produce (F = m·a) while
 * `v` does not — raising the top speed only lengthens the runway. So an axis that
 * misbehaves at high speed with an acceleration that was fine at low speed is telling
 * you the SPEED is too high, not the acceleration.
 */
function Derived({
  rate,
  accel,
  stepsPerMm,
  pulseUs,
  perRev,
  rotary
}: {
  rate: number
  accel: number
  stepsPerMm: number
  pulseUs: number
  perRev: number
  rotary: boolean
}): JSX.Element | null {
  const t = useT()
  if (!(rate > 0) || !(accel > 0)) return null
  const vps = rate / 60 // mm (or °) per second
  const rampT = vps / accel
  const rampD = (vps * vps) / (2 * accel)
  const stepHz = (rate * stepsPerMm) / 60
  const maxHz = pulseUs > 0 ? 1e6 / (pulseUs + 2) : 0
  const rpm = perRev > 0 ? rate / perRev : 0
  // Two ways this pair stops being real: the board can't step that fast, or the motor
  // is spun past where a 1.8° stepper still has useful torque. RPM_SOFT is a rule of
  // thumb for direct-driven steppers, not a hard number — hence a tint, not a block.
  const tight = (maxHz > 0 && stepHz > 0.85 * maxHz) || rpm > RPM_SOFT
  const u = rotary ? '°' : 'mm'
  return (
    <div className={`mt-1 font-mono text-[10px] leading-relaxed ${tight ? 'text-warn' : 'text-slate-500'}`}>
      {t('ui.tune.derived', {
        t: rampT.toFixed(2),
        d: `${rampD.toFixed(1)} ${u}`,
        m: `${(rampD * 2).toFixed(1)} ${u}`
      })}
      {rpm > 0 && ` · ${Math.round(rpm)} ${t('ui.tune.rpm')}`}
      {maxHz > 0 && ` · ${(stepHz / 1000).toFixed(1)}/${(maxHz / 1000).toFixed(0)} kHz`}
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
