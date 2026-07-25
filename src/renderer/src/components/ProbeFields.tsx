/** Shared numeric field + labelled group used by both the Probe panel and
 *  Settings → Probe (so the parameters look identical in both places). */

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
  onChange,
  step = 1
}: {
  label: string
  unit: string
  value: number
  onChange: (v: number) => void
  step?: number
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="input w-16 !py-1 text-right font-mono text-xs"
        />
        <span className="w-12 font-mono text-[10px] text-slate-600">{unit}</span>
      </span>
    </label>
  )
}
