/** Shared numeric field + labelled group used by both the Probe panel and
 *  Settings → Probe (so the parameters look identical in both places). */

import { useState } from 'react'

export function ProbeGroup({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-panel2 p-2.5">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

export function ProbeField({
  label,
  unit,
  value,
  onChange
}: {
  label: string
  unit: string
  value: number
  onChange: (v: number) => void
}): JSX.Element {
  /** What is being typed, while it is being typed.
   *
   *  Bound straight to the number, an emptied box reads as `Number('') === 0`, the
   *  store says 0, and the 0 comes straight back — so you cannot clear the field,
   *  and typing 25 over it gives 025. The draft lets the box be EMPTY for as long
   *  as someone is mid-edit; the store only hears actual numbers, and on blur the
   *  box goes back to showing whatever the store ended up with. */
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="flex items-center gap-1">
        {/* Plain box, no steppers. Every value here is something you measured, so
            it gets typed, not nudged — and `step` on a spinner turns 1.2 into a
            fight with the arrows. `any` keeps the numeric keypad on touch. */}
        <input
          type="number"
          step="any"
          value={draft ?? String(value)}
          onChange={(e) => {
            const text = e.target.value
            setDraft(text)
            const n = Number(text)
            if (text !== '' && Number.isFinite(n)) onChange(n)
          }}
          onBlur={() => setDraft(null)}
          className="input w-16 !py-1 text-right font-mono text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="w-12 font-mono text-[10px] text-slate-600">{unit}</span>
      </span>
    </label>
  )
}
