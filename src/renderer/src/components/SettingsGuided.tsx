import { useEffect, useState } from 'react'
import { SECTIONS, RESET_REQUIRED, coveredSettings, settingCategory, type Field, type EnumOpt } from '@shared/machine-config'
import { settingName, settingDesc, genericKind, maskBits, ROTARY_MASK_SETTINGS } from '@shared/settings-meta'
import { useStore } from '../store'
import { useT, useLang } from '../i18n'
import { StepsCalculator } from './StepsCalculator'
import { StepperTuning } from './StepperTuning'
import { CalcIcon, SlidersIcon, SectionIcon } from './icons'

const DEFAULT_AXES = ['X', 'Y', 'Z']

// Curated bitFlags / enum fields keyed by `$` number, so the raw "All settings"
// view reuses the SAME friendly bit names / option labels as the guided sections —
// instead of nameless "bit 0..3" checkboxes or a bare index number. One source of
// truth → the two views can't disagree (fixes the $372 / $374 inconsistency).
const CURATED_FIELD: Record<number, Extract<Field, { kind: 'bitFlags' | 'enum' }>> = {}
for (const sec of SECTIONS) {
  for (const f of sec.fields) {
    if (f.kind === 'bitFlags' || f.kind === 'enum') CURATED_FIELD[f.setting] = f
  }
}

/** Friendly machine setup — renders the SECTIONS model as plain controls and
 *  writes the underlying `$N=value` via `write`. Reads current values from `vals`
 *  (a num→string map of the last `$$` read). All labels are i18n keys resolved
 *  through `t()`. */
export function SettingsGuided({
  vals,
  axes,
  write,
  filter = '',
  selected
}: {
  vals: Record<number, string>
  axes: string[]
  write: (setting: number, value: string | number) => void
  filter?: string
  /** Which category (section id) to show. `'advanced'` shows every category at
   *  once (all reported settings). A non-empty `filter` overrides this and searches
   *  across all categories. */
  selected?: string
}): JSX.Element {
  const t = useT()
  const lang = useLang()
  const ax = axes.length ? axes : DEFAULT_AXES
  const [calcOpen, setCalcOpen] = useState(false)
  const [tuneOpen, setTuneOpen] = useState(false)
  const num = (n: number): number => {
    const v = parseFloat(vals[n] ?? '')
    return Number.isFinite(v) ? v : 0
  }

  const modals = (
    <>
      {calcOpen && <StepsCalculator axes={ax} write={write} onClose={() => setCalcOpen(false)} />}
      {tuneOpen && <StepperTuning axes={ax} vals={vals} write={write} onClose={() => setTuneOpen(false)} />}
    </>
  )

  const covered = coveredSettings(ax.length)
  const reported = Object.keys(vals).map(Number)
  const q = filter.trim().toLowerCase()

  // does a `$` setting match the search query (number / name / description)?
  const settingMatches = (n: number): boolean =>
    !q ||
    `$${n}`.includes(q) ||
    String(n) === q ||
    settingName(n, lang).toLowerCase().includes(q) ||
    (settingDesc(n, lang)?.toLowerCase().includes(q) ?? false)

  // does a curated field match — by its setting (if any) or its own label/desc?
  const fieldMatches = (f: Field): boolean => {
    if (!q) return true
    if ('setting' in f && settingMatches(f.setting)) return true
    if ('base' in f && ax.some((_, i) => settingMatches(f.base + i))) return true
    if ('label' in f && t(f.label).toLowerCase().includes(q)) return true
    if ('desc' in f && f.desc && t(f.desc).toLowerCase().includes(q)) return true
    // the motor table covers the per-axis $100/$110/$120/$130 family
    if (f.kind === 'motorTuning') return ax.some((_, i) => [100, 110, 120, 130].some((b) => settingMatches(b + i)))
    return false
  }

  const empty = (
    <div className="p-8 text-center font-mono text-sm text-slate-500">{t('ui.settings.noResults', { query: filter })}</div>
  )

  // "All settings" — the complete raw $$ list: every reported setting in numeric
  // order, nothing hidden or curated, so power users can jump straight to any $N.
  if (selected === 'advanced') {
    const all = reported.filter(settingMatches).sort((a, b) => a - b)
    return (
      <div className="flex flex-col gap-3 p-4">
        {all.length === 0 ? (
          empty
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            {all.map((n, i) => (
              <GenericRow key={n} n={n} value={vals[n] ?? ''} axes={ax} write={write} last={i === all.length - 1} />
            ))}
          </div>
        )}
        {modals}
      </div>
    )
  }

  // which categories to render: search → all (filtered); otherwise just the picked one
  const single = !q
  const sections = q ? SECTIONS : SECTIONS.filter((s) => s.id === selected)

  let anyShown = false

  return (
    <div className="flex flex-col gap-5 p-4">
      {sections.map((sec) => {
        const fields = sec.fields.filter(fieldMatches)
        // every reported setting in this category that isn't already a curated field
        const extras = reported
          .filter((n) => !covered.has(n) && settingCategory(n) === sec.id && settingMatches(n))
          .sort((a, b) => a - b)
        // in single-category view keep the header even when empty (show a note);
        // in search / all views just skip empty categories
        if (fields.length === 0 && extras.length === 0) {
          if (!single) return null
          return (
            <section key={sec.id}>
              <h3 className="mb-2 flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-brand">
                <SectionIcon id={sec.id} className="h-4 w-4" />
                {t(sec.title)}
              </h3>
              <div className="rounded-lg border border-border p-6 text-center font-mono text-xs text-slate-500">
                {t('ui.settings.sectionEmpty')}
              </div>
            </section>
          )
        }
        anyShown = true

        return (
          <section key={sec.id}>
            <h3 className="mb-2 flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-brand">
              <SectionIcon id={sec.id} className="h-4 w-4" />
              {t(sec.title)}
            </h3>
            {sec.note && (
              <div className="mb-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-1.5 text-[11px] leading-snug text-warn">
                {t(sec.note)}
              </div>
            )}
            <div className="overflow-hidden rounded-lg border border-border">
              {fields.map((f, i) =>
                f.kind === 'motorTuning' ? (
                  <MotorTuning key={`f${i}`} axes={ax} vals={vals} write={write} first={i === 0} />
                ) : (
                  <FieldRow
                    key={`f${i}`}
                    field={f}
                    axes={ax}
                    num={num}
                    vals={vals}
                    write={write}
                    onOpenCalc={() => setCalcOpen(true)}
                    onOpenTune={() => setTuneOpen(true)}
                    last={i === fields.length - 1 && extras.length === 0}
                  />
                )
              )}
              {extras.map((n, idx) => (
                <GenericRow
                  key={`e${n}`}
                  n={n}
                  value={vals[n] ?? ''}
                  axes={ax}
                  write={write}
                  last={idx === extras.length - 1}
                />
              ))}
            </div>
          </section>
        )
      })}

      {!anyShown && q && empty}

      {modals}
    </div>
  )
}

/** A reported setting that has no curated control — shown in its logical section
 *  with $N + name + description and the smart control for its kind. */
function GenericRow({
  n,
  value,
  axes,
  write,
  last
}: {
  n: number
  value: string
  axes: string[]
  write: (setting: number, value: string | number) => void
  last: boolean
}): JSX.Element {
  const lang = useLang()
  const t = useT()
  return (
    <div className={`flex items-start gap-6 px-3 py-2.5 hover:bg-panel2 ${last ? '' : 'border-b border-border/60'}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-200">
          <span className="mr-2 font-mono text-xs text-brand">${n}</span>
          {settingName(n, lang)}
          {RESET_REQUIRED.has(n) && (
            <span className="ml-3 text-[10px] font-medium text-warn">{t('ui.settings.resetNote')}</span>
          )}
        </div>
        {settingDesc(n, lang) && <div className="text-[11px] leading-snug text-slate-500">{settingDesc(n, lang)}</div>}
      </div>
      <div className="w-[32rem] shrink-0">
        <GenericValue n={n} value={value} axes={axes} write={write} />
      </div>
    </div>
  )
}

/** Renders a not-otherwise-curated setting with the right control for its kind:
 *  on/off → toggle, per-axis mask → axis switches, IP/host → text, else number. */
function GenericValue({
  n,
  value,
  axes,
  write
}: {
  n: number
  value: string
  axes: string[]
  write: (setting: number, value: string | number) => void
}): JSX.Element {
  const t = useT()
  const lang = useLang()
  // $376/$538 rotary masks: value bit 0 = first rotary axis (A). Only axes beyond
  // X/Y/Z are selectable; sending the wrong bit (e.g. 8 for A) makes grbl error.
  if (ROTARY_MASK_SETTINGS.has(n)) {
    const v = parseInt(value, 10) || 0
    const rotary = axes.slice(3)
    if (rotary.length === 0) return <span className="text-[11px] text-slate-500">{t('ui.settings.noRotary')}</span>
    return (
      <AxisSwitches
        axes={rotary}
        mask={v}
        onToggle={(i) => write(n, (v & (1 << i)) !== 0 ? v & ~(1 << i) : v | (1 << i))}
      />
    )
  }
  // $13 report-in-inches is a real on/off — show the units switch (which also
  // keeps the app's DRO/header in sync), never a raw number box.
  if (n === 13) return <UnitsToggle />
  // $395 default spindle → live picker of the firmware's registered spindles.
  if (n === 395) {
    const cf395 = CURATED_FIELD[395]
    return (
      <SpindlePicker
        value={parseInt(value, 10) || 0}
        write={write}
        fallback={cf395?.kind === 'enum' ? cf395.options : undefined}
      />
    )
  }
  // reuse the guided section's curated control for this setting, so the raw list
  // shows the same named bits / labelled options (not "bit 0..3" or a bare index)
  const cf = CURATED_FIELD[n]
  if (cf?.kind === 'enum') {
    return <GenericEnum value={parseInt(value, 10) || 0} options={cf.options} onChange={(nv) => write(n, nv)} />
  }
  if (cf?.kind === 'bitFlags') {
    const v = parseInt(value, 10) || 0
    return <CheckboxList value={v} bits={cf.bits.map((b) => ({ bit: b.bit, label: t(b.label) }))} onChange={(nv) => write(n, nv)} />
  }
  const kind = genericKind(n)
  if (kind === 'bool') {
    const on = (parseFloat(value) || 0) !== 0
    return <Toggle on={on} onClick={() => write(n, on ? 0 : 1)} />
  }
  if (kind === 'axisMask') {
    const mask = parseInt(value, 10) || 0
    return (
      <AxisSwitches
        axes={axes}
        mask={mask}
        onToggle={(i) => write(n, (mask & (1 << i)) !== 0 ? mask & ~(1 << i) : mask | (1 << i))}
      />
    )
  }
  if (kind === 'bitFlags') {
    const v = parseInt(value, 10) || 0
    return <CheckboxList value={v} bits={maskBits(n, v, lang)} onChange={(nv) => write(n, nv)} />
  }
  if (kind === 'text') return <TextBox value={value} onCommit={(v) => write(n, v)} />
  return <NumberBox value={value} onCommit={(v) => write(n, v)} />
}

/** The `$N` prefix shown before every setting's label. $13 for the units
 *  control; the base for per-axis numeric blocks; null for pure tools. */
function fieldTag(f: Field): string | null {
  if (f.kind === 'displayUnits') return '$13'
  if (f.kind === 'axisNumber') return `$${f.base}+`
  if ('setting' in f) return `$${f.setting}`
  return null
}

function FieldRow({
  field,
  axes,
  num,
  vals,
  write,
  onOpenCalc,
  onOpenTune,
  last
}: {
  field: Field
  axes: string[]
  num: (n: number) => number
  vals: Record<number, string>
  write: (setting: number, value: string | number) => void
  onOpenCalc: () => void
  onOpenTune: () => void
  last: boolean
}): JSX.Element {
  const t = useT()
  const label = 'label' in field ? t(field.label) : ''
  const desc = 'desc' in field && field.desc ? t(field.desc) : undefined
  const tag = fieldTag(field)

  return (
    <div className={`flex items-start gap-6 px-3 py-2.5 hover:bg-panel2 ${last ? '' : 'border-b border-border/60'}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-200">
          {tag && <span className="mr-2 font-mono text-xs text-brand">{tag}</span>}
          {label}
          {'setting' in field && RESET_REQUIRED.has(field.setting) && (
            <span className="ml-3 text-[10px] font-medium text-warn">{t('ui.settings.resetNote')}</span>
          )}
        </div>
        {desc && <div className="text-[11px] leading-snug text-slate-500">{desc}</div>}
      </div>
      <div className="w-[32rem] shrink-0">
        <Control
          field={field}
          axes={axes}
          num={num}
          vals={vals}
          write={write}
          onOpenCalc={onOpenCalc}
          onOpenTune={onOpenTune}
        />
      </div>
    </div>
  )
}

function Control({
  field,
  axes,
  num,
  vals,
  write,
  onOpenCalc,
  onOpenTune
}: {
  field: Field
  axes: string[]
  num: (n: number) => number
  vals: Record<number, string>
  write: (setting: number, value: string | number) => void
  onOpenCalc: () => void
  onOpenTune: () => void
}): JSX.Element {
  const t = useT()
  const connected = useStore((s) => s.connected)
  switch (field.kind) {
    case 'bool': {
      const on = num(field.setting) !== 0
      return <Toggle on={on} onClick={() => write(field.setting, on ? 0 : 1)} />
    }
    case 'flagBit': {
      const v = num(field.setting)
      const on = (v & (1 << field.bit)) !== 0
      return <Toggle on={on} onClick={() => write(field.setting, on ? v & ~(1 << field.bit) : v | (1 << field.bit))} />
    }
    case 'axisMask': {
      const mask = num(field.setting)
      return (
        <AxisSwitches
          axes={axes}
          mask={mask}
          onToggle={(i) => write(field.setting, (mask & (1 << i)) !== 0 ? mask & ~(1 << i) : mask | (1 << i))}
        />
      )
    }
    case 'bitFlags': {
      const v = num(field.setting)
      const bits = field.bits.map((b) => ({ bit: b.bit, label: t(b.label) }))
      return <CheckboxList value={v} bits={bits} onChange={(nv) => write(field.setting, nv)} />
    }
    case 'enum': {
      // $395 default spindle → live picker driven by the firmware's registered
      // spindles (the static PWM/Huanyang options are only a fallback).
      if (field.setting === 395)
        return <SpindlePicker value={num(field.setting)} write={write} fallback={field.options} />
      const v = num(field.setting)
      const grid = field.columns
      const opts = field.options.map((o) => (
        <label
          key={o.value}
          className={`flex cursor-pointer gap-2 text-xs text-slate-300 ${grid ? 'items-center' : 'items-start'}`}
        >
          <input
            type="radio"
            className={`h-4 w-4 shrink-0 accent-brand ${grid ? '' : 'mt-0.5'}`}
            checked={v === o.value}
            onChange={() => write(field.setting, o.value)}
          />
          <span>
            <span className={v === o.value ? 'text-slate-100' : ''}>{t(o.label)}</span>
            {o.desc && <span className="block text-[10px] leading-snug text-slate-500">{t(o.desc)}</span>}
          </span>
        </label>
      ))
      return (
        <div className="flex flex-col gap-1.5">
          {grid ? (
            <div
              className="grid gap-x-5 gap-y-1.5"
              style={{ gridTemplateColumns: `repeat(${grid}, minmax(0, max-content))` }}
            >
              {opts}
            </div>
          ) : (
            opts
          )}
          {!field.options.some((o) => o.value === v) && (
            <span className="text-[10px] text-slate-500">{t('ui.settings.unknown', { v })}</span>
          )}
        </div>
      )
    }
    case 'number':
      return <NumberBox value={vals[field.setting] ?? ''} unit={field.unit} onCommit={(v) => write(field.setting, v)} />
    case 'text':
      return (
        <TextBox
          value={vals[field.setting] ?? ''}
          placeholder={field.placeholder}
          onCommit={(v) => write(field.setting, v)}
        />
      )
    case 'auxButtons':
      return <AuxButtonsControl />
    case 'displayUnits':
      return <UnitsToggle />
    case 'motorTuning':
      return <></> // rendered separately (full width) by the section
    case 'axisNumber':
      return (
        <div className="flex gap-2">
          {axes.map((a, i) => (
            <div key={a} className="flex flex-col items-center">
              <span className="mb-0.5 font-mono text-[10px] text-slate-500">{a}</span>
              <NumberBox
                value={vals[field.base + i] ?? ''}
                unit={field.unit}
                compact
                onCommit={(v) => write(field.base + i, v)}
              />
            </div>
          ))}
        </div>
      )
    case 'stepsCalc':
      return (
        <button
          onClick={onOpenCalc}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand/50 bg-panel2 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand hover:text-[#020617]"
        >
          <CalcIcon className="h-3.5 w-3.5" /> {t('ui.settings.open')}
        </button>
      )
    case 'tuneSlider':
      return (
        <button
          onClick={onOpenTune}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand/50 bg-panel2 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand hover:text-[#020617]"
        >
          <SlidersIcon className="h-3.5 w-3.5" /> {t('ui.settings.open')}
        </button>
      )
    case 'jogTest': {
      const dist = field.distance ?? 5
      const feed = field.feed ?? 1000
      return (
        <div className="flex gap-2.5">
          {axes.map((a) => (
            <div key={a} className="flex items-center gap-0.5">
              <JogBtn label="−" disabled={!connected} onClick={() => window.recta.jog(a, -dist, feed)} />
              <span className="px-0.5 font-mono text-[11px] text-slate-400">{a}</span>
              <JogBtn label="+" disabled={!connected} onClick={() => window.recta.jog(a, dist, feed)} />
            </div>
          ))}
        </div>
      )
    }
  }
}

function JogBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-7 rounded-md border border-border2 bg-panel2 font-mono text-sm font-bold text-slate-200 transition hover:border-brand hover:text-brand disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  const t = useT()
  return (
    <button
      onClick={onClick}
      className={`relative h-6 w-11 rounded-full transition ${on ? 'bg-ok' : 'bg-border2'}`}
      title={on ? t('ui.toggle.on') : t('ui.toggle.off')}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  )
}

/** Per-axis invert as a row of labelled mini-switches — one switch per machine
 *  axis (bit i = axis i). Green/on = inverted for that axis. No bitmask typing. */
function AxisSwitches({
  axes,
  mask,
  onToggle
}: {
  axes: string[]
  mask: number
  onToggle: (axisIndex: number) => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="flex gap-2.5">
      {axes.map((a, i) => {
        const on = (mask & (1 << i)) !== 0
        return (
          <button
            key={a}
            onClick={() => onToggle(i)}
            title={on ? t('ui.axis.inverted', { axis: a }) : t('ui.axis.normal', { axis: a })}
            className="flex flex-col items-center gap-1"
          >
            <span className={`font-mono text-[11px] font-bold ${on ? 'text-ok' : 'text-slate-500'}`}>{a}</span>
            <span className={`relative h-6 w-11 rounded-full transition ${on ? 'bg-ok' : 'bg-border2'}`}>
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
              />
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Measurement unit = the controller's $13 (report inches). One switch: off = mm
 *  (default), on = inch. Writes $13 to the board and mirrors it in the app so the
 *  DRO/header reflect it directly. */
function UnitsToggle(): JSX.Element {
  const t = useT()
  const units = useStore((s) => s.units)
  const setUnits = useStore((s) => s.setUnits)
  const inch = units === 'inch'
  const flip = (): void => {
    const u = inch ? 'mm' : 'inch'
    setUnits(u)
    window.recta.send(`$13=${u === 'inch' ? 1 : 0}`)
  }
  return (
    <div className="flex items-center gap-2">
      <Toggle on={inch} onClick={flip} />
      <span className="font-mono text-xs text-slate-400">{inch ? t('ui.units.inch') : t('ui.units.mm')}</span>
    </div>
  )
}

/** AUX/coolant output button visibility (UI pref) — chips toggle store.auxButtons. */
function AuxButtonsControl(): JSX.Element {
  const aux = useStore((s) => s.auxButtons)
  const setAuxButton = useStore((s) => s.setAuxButton)
  const items: { key: 'mist' | 'flood' | 'vac'; label: string }[] = [
    { key: 'mist', label: 'MIST' },
    { key: 'flood', label: 'FLOOD' },
    { key: 'vac', label: 'VAC' }
  ]
  return (
    <div className="flex gap-1.5">
      {items.map((it) => (
        <Chip key={it.key} label={it.label} on={aux[it.key]} onClick={() => setAuxButton(it.key, !aux[it.key])} />
      ))}
    </div>
  )
}

/** Vertical list of labelled checkboxes for a bitmask — every option is spelled
 *  out and the user just ticks them; the bit number is irrelevant. A single-option
 *  mask is really on/off, so it shows a switch. Two columns when there are many. */
function CheckboxList({
  value,
  bits,
  onChange
}: {
  value: number
  bits: { bit: number; label: string }[]
  onChange: (next: number) => void
}): JSX.Element {
  if (bits.length === 1) {
    const b = bits[0]
    const on = (value & (1 << b.bit)) !== 0
    return (
      <div className="flex items-center gap-2">
        <Toggle on={on} onClick={() => onChange(on ? value & ~(1 << b.bit) : value | (1 << b.bit))} />
        <span className="text-xs text-slate-400">{b.label}</span>
      </div>
    )
  }
  const twoCol = bits.length > 7
  return (
    <div className={twoCol ? 'grid grid-cols-2 gap-x-5 gap-y-1.5' : 'flex flex-col gap-1.5'}>
      {bits.map((b) => {
        const on = (value & (1 << b.bit)) !== 0
        return (
          <label key={b.bit} className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-brand"
              checked={on}
              onChange={() => onChange(on ? value & ~(1 << b.bit) : value | (1 << b.bit))}
            />
            {b.label}
          </label>
        )
      })}
    </div>
  )
}

/** Compact dropdown for an index-based setting (e.g. $374 Modbus baud) in the raw
 *  "All settings" list — shows the labelled option, not the bare index number. */
function GenericEnum({
  value,
  options,
  onChange
}: {
  value: number
  options: EnumOpt[]
  onChange: (v: number) => void
}): JSX.Element {
  const t = useT()
  const known = options.some((o) => o.value === value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="input w-full !py-1 font-mono text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {t(o.label)}
        </option>
      ))}
      {!known && <option value={value}>{t('ui.settings.unknown', { v: value })}</option>}
    </select>
  )
}

/** Live picker for $395 "Default spindle". Lists the drivers the firmware actually
 *  registered (enumerated from `$SPINDLESH` into the store), so a fully-loaded build
 *  offers analog PWM + every compiled Modbus VFD instead of a hard-coded PWM/Huanyang
 *  pair. $395 stores the spindle *id*. Falls back to the section's static options
 *  (then a raw number box) if the board hasn't answered the enumeration yet. */
function SpindlePicker({
  value,
  write,
  fallback
}: {
  value: number
  write: (setting: number, value: string | number) => void
  fallback?: EnumOpt[]
}): JSX.Element {
  const t = useT()
  const spindles = useStore((s) => s.info.spindles)
  const connected = useStore((s) => s.connected)
  // Fill the list if the connection predates this query (or the connect-time
  // enumeration was missed) — ask once, when there's nothing to show yet.
  useEffect(() => {
    if (connected && spindles.length === 0) window.recta.send('$SPINDLESH')
  }, [connected, spindles.length])

  const options = spindles.length
    ? spindles.map((s) => ({ value: s.id, label: spindleLabel(s.name) }))
    : (fallback ?? []).map((o) => ({ value: o.value, label: t(o.label) }))

  if (options.length === 0) return <NumberBox value={String(value)} onCommit={(v) => write(395, v)} />

  const known = options.some((o) => o.value === value)
  return (
    <select
      value={value}
      onChange={(e) => write(395, Number(e.target.value))}
      className="input w-full !py-1 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {!known && <option value={value}>{t('ui.settings.unknown', { v: value })}</option>}
    </select>
  )
}

/** Friendlier label for the analog driver; VFD names from the firmware are already clear. */
function spindleLabel(name: string): string {
  return name === 'PWM' ? 'PWM (0–10 V analog)' : name
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 font-mono text-xs font-semibold transition ${
        on ? 'border-brand bg-brand text-[#020617]' : 'border-border2 bg-panel2 text-slate-400 hover:border-brand'
      }`}
    >
      {label}
    </button>
  )
}

function NumberBox({
  value,
  unit,
  compact,
  onCommit
}: {
  value: string
  unit?: string
  compact?: boolean
  onCommit: (v: string) => void
}): JSX.Element {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  const commit = (): void => {
    if (local.trim() !== '' && local !== value) onCommit(local.trim())
  }
  return (
    <div className="flex items-center gap-1">
      <input
        className={`input !py-1 text-right font-mono text-xs ${compact ? 'w-20' : 'w-28'}`}
        value={local}
        inputMode="decimal"
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {unit && <span className="w-12 font-mono text-[10px] text-slate-500">{unit}</span>}
    </div>
  )
}

function TextBox({
  value,
  placeholder,
  onCommit
}: {
  value: string
  placeholder?: string
  onCommit: (v: string) => void
}): JSX.Element {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  const commit = (): void => {
    if (local !== value) onCommit(local.trim())
  }
  return (
    <input
      className="input !py-1 w-44 text-right font-mono text-xs"
      value={local}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** Mach3-style motor tuning: a row per axis with steps/mm, max rate, acceleration
 *  and max travel, plus a small velocity-profile sparkline (taller = faster,
 *  steeper ramp = more acceleration). */
function MotorTuning({
  axes,
  vals,
  write,
  first
}: {
  axes: string[]
  vals: Record<number, string>
  write: (setting: number, value: string | number) => void
  first: boolean
}): JSX.Element {
  const t = useT()
  const n = (s: number): number => {
    const v = parseFloat(vals[s] ?? '')
    return Number.isFinite(v) ? v : 0
  }
  // normalization across axes for the comparative sparklines
  const rates = axes.map((_, i) => n(110 + i))
  const ramps = axes.map((_, i) => {
    const a = n(120 + i)
    return a > 0 ? n(110 + i) / 60 / a : 0 // time-to-max (s)
  })
  const maxRate = Math.max(...rates, 1)
  const maxRamp = Math.max(...ramps, 0.0001)

  return (
    <div className={`px-3 py-3 ${first ? '' : 'border-t border-border/60'}`}>
      <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_3.5rem] items-center gap-2 pb-1 font-mono text-[10px] text-slate-500">
        <span>{t('ui.motor.axis')}</span>
        <span>{t('ui.motor.stepsmm')}</span>
        <span>{t('ui.motor.maxrate')}</span>
        <span>{t('ui.motor.accel')}</span>
        <span>{t('ui.motor.travel')}</span>
        <span className="text-center">{t('ui.motor.profile')}</span>
      </div>
      {axes.map((a, i) => (
        <div key={a} className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_3.5rem] items-center gap-2 py-1">
          <span className="font-mono text-sm font-bold text-brand">{a}</span>
          <CellInput value={vals[100 + i] ?? ''} onCommit={(v) => write(100 + i, v)} />
          <CellInput value={vals[110 + i] ?? ''} onCommit={(v) => write(110 + i, v)} />
          <CellInput value={vals[120 + i] ?? ''} onCommit={(v) => write(120 + i, v)} />
          <CellInput value={vals[130 + i] ?? ''} onCommit={(v) => write(130 + i, v)} />
          <VelocityProfile heightFrac={rates[i] / maxRate} rampFrac={ramps[i] / maxRamp} />
        </div>
      ))}

      {/* legend / explanation of the profile sparkline */}
      <div className="mt-2 flex items-start gap-2 rounded-md bg-panel2 px-2.5 py-2 text-[10px] leading-snug text-slate-500">
        <svg width="40" height="20" className="mt-0.5 shrink-0" aria-hidden>
          <polyline points="2,17 12,4 28,4 38,17" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span>{t('ui.motor.legend')}</span>
      </div>
    </div>
  )
}

function CellInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }): JSX.Element {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <input
      className="input !py-1 w-full text-right font-mono text-xs"
      value={local}
      inputMode="decimal"
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => local.trim() !== '' && local !== value && onCommit(local.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** A compact trapezoidal velocity profile (accelerate → cruise → decelerate). */
function VelocityProfile({ heightFrac, rampFrac }: { heightFrac: number; rampFrac: number }): JSX.Element {
  const w = 52
  const h = 26
  const pad = 2
  const top = pad + (1 - Math.max(0.05, Math.min(1, heightFrac))) * (h - 2 * pad)
  const ramp = pad + Math.max(0, Math.min(1, rampFrac)) * (w / 2 - pad - 4)
  const pts = `${pad},${h - pad} ${ramp},${top} ${w - ramp},${top} ${w - pad},${h - pad}`
  return (
    <svg width={w} height={h} className="rounded bg-panel2" aria-hidden>
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
