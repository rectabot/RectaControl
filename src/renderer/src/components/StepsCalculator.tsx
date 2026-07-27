import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { CalcIcon } from './icons'

export type Mech = 'leadscrew' | 'belt' | 'rack' | 'rotary'

/** Steps-per-mm (or per-degree for a rotary axis) calculator. Computes $100.. from
 *  motor step angle, driver microstepping and the drive mechanism, then applies
 *  the result to a chosen axis via `write` (base setting 100 + axis index). */
export function StepsCalculator({
  axes,
  write,
  onClose
}: {
  axes: string[]
  write: (setting: number, value: string | number) => void
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const setAxisMech = useStore((s) => s.setAxisMech)
  const setAxisPerRev = useStore((s) => s.setAxisPerRev)
  const [angle, setAngle] = useState('1.8') // motor step angle (°)
  const [micro, setMicro] = useState('16') // driver microsteps
  const [mech, setMech] = useState<Mech>('leadscrew')

  // mechanism params
  const [lead, setLead] = useState('5') // leadscrew lead, mm/rev (SFU1605 = 5)
  const [pitch, setPitch] = useState('2') // belt pitch, mm (GT2 = 2)
  const [teeth, setTeeth] = useState('20') // pulley / pinion teeth
  const [module, setModule] = useState('1') // rack module, mm
  const [gear, setGear] = useState('1') // rotary gear ratio (motor:axis)

  const fullSteps = useMemo(() => {
    const a = parseFloat(angle)
    return Number.isFinite(a) && a > 0 ? 360 / a : 0
  }, [angle])

  const result = useMemo(() => {
    const totalPerRev = fullSteps * (parseFloat(micro) || 0) // microsteps per motor rev
    if (totalPerRev <= 0) return { value: 0, unit: 'st/mm', rotary: false, perRev: 0 }
    const n = (x: string): number => parseFloat(x) || 0
    // `perRev` = how far the axis travels per MOTOR revolution (mm, or ° for rotary).
    // Kept alongside steps/mm because it is what turns a feed rate into motor rpm.
    switch (mech) {
      case 'leadscrew': {
        const travel = n(lead)
        return { value: travel > 0 ? totalPerRev / travel : 0, unit: 'st/mm', rotary: false, perRev: travel }
      }
      case 'belt': {
        const travel = n(pitch) * n(teeth) // mm per rev
        return { value: travel > 0 ? totalPerRev / travel : 0, unit: 'st/mm', rotary: false, perRev: travel }
      }
      case 'rack': {
        const travel = Math.PI * n(module) * n(teeth) // pinion circumference, mm per rev
        return { value: travel > 0 ? totalPerRev / travel : 0, unit: 'st/mm', rotary: false, perRev: travel }
      }
      case 'rotary': {
        // steps per degree of the axis (after gearing)
        const g = n(gear)
        const perAxisRev = totalPerRev * g
        return { value: perAxisRev / 360, unit: 'st/°', rotary: true, perRev: g > 0 ? 360 / g : 0 }
      }
    }
  }, [fullSteps, micro, mech, lead, pitch, teeth, module, gear])

  const valueStr = result.value > 0 ? result.value.toFixed(3) : '—'

  const MECHS: { id: Mech; label: string }[] = [
    { id: 'leadscrew', label: t('ui.calc.mech.leadscrew') },
    { id: 'belt', label: t('ui.calc.mech.belt') },
    { id: 'rack', label: t('ui.calc.mech.rack') },
    { id: 'rotary', label: t('ui.calc.mech.rotary') }
  ]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-8" onClick={onClose}>
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-panel p-5 shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center">
          <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold tracking-wider text-brand">
            <CalcIcon /> {t('ui.calc.title')}
          </span>
          <button className="btn ml-auto text-xs" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* motor + driver */}
        <div className="grid grid-cols-2 gap-3">
          <Labeled label={t('ui.calc.motorStep')}>
            <select className="input !py-1 text-sm" value={angle} onChange={(e) => setAngle(e.target.value)}>
              <option value="1.8">{t('ui.calc.step18')}</option>
              <option value="0.9">{t('ui.calc.step09')}</option>
            </select>
          </Labeled>
          <Labeled label={t('ui.calc.micro')}>
            <select className="input !py-1 text-sm" value={micro} onChange={(e) => setMicro(e.target.value)}>
              {['1', '2', '4', '8', '16', '32', '64', '128', '256'].map((m) => (
                <option key={m} value={m}>
                  {m}×
                </option>
              ))}
            </select>
          </Labeled>
        </div>

        {/* mechanism */}
        <Labeled label={t('ui.calc.mech')}>
          <div className="grid grid-cols-2 gap-1.5">
            {MECHS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMech(m.id)}
                className={`rounded-md border px-2 py-1.5 text-xs font-semibold transition ${
                  mech === m.id ? 'border-brand bg-brand text-[#020617]' : 'border-border2 bg-panel2 text-slate-300 hover:border-brand'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Labeled>

        {/* mechanism params */}
        {mech === 'leadscrew' && (
          <Num label={t('ui.calc.lead')} value={lead} onChange={setLead} hint={t('ui.calc.lead.hint')} />
        )}
        {mech === 'belt' && (
          <div className="grid grid-cols-2 gap-3">
            <Num label={t('ui.calc.beltPitch')} value={pitch} onChange={setPitch} hint={t('ui.calc.beltPitch.hint')} />
            <Num label={t('ui.calc.pulleyTeeth')} value={teeth} onChange={setTeeth} />
          </div>
        )}
        {mech === 'rack' && (
          <div className="grid grid-cols-2 gap-3">
            <Num label={t('ui.calc.module')} value={module} onChange={setModule} hint={t('ui.calc.module.hint')} />
            <Num label={t('ui.calc.pinionTeeth')} value={teeth} onChange={setTeeth} />
          </div>
        )}
        {mech === 'rotary' && (
          <Num label={t('ui.calc.gear')} value={gear} onChange={setGear} hint={t('ui.calc.gear.hint')} />
        )}

        {/* result */}
        <div className="flex items-baseline justify-center gap-2 rounded-md border border-border bg-panel2 py-3">
          <span className="font-mono text-3xl font-bold text-brand tabular-nums">{valueStr}</span>
          <span className="font-mono text-sm text-slate-400">{result.unit}</span>
        </div>

        {/* apply */}
        <div>
          <div className="mb-1.5 text-center font-mono text-[11px] text-slate-500">{t('ui.calc.applyTo')}</div>
          <div className="flex justify-center gap-2">
            {axes.map((a, i) => (
              <button
                key={a}
                disabled={result.value <= 0}
                onClick={() => {
                  write(100 + i, valueStr)
                  // remember WHAT this axis is driven by, and how far it travels per
                  // motor turn — tuning caps the speed slider differently for a lead
                  // screw than for a rack, and needs perRev to show motor rpm
                  setAxisMech(i, mech)
                  if (result.perRev > 0) setAxisPerRev(i, result.perRev)
                }}
                className="h-9 w-12 rounded-md border border-brand/50 bg-panel2 font-mono text-sm font-bold text-brand transition hover:bg-brand hover:text-[#020617] disabled:opacity-40"
                title={`$${100 + i} = ${valueStr}`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Num({
  label,
  value,
  onChange,
  hint
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] text-slate-500">{label}</span>
      <input
        className="input !py-1 font-mono text-sm"
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="font-mono text-[10px] text-slate-600">{hint}</span>}
    </label>
  )
}
