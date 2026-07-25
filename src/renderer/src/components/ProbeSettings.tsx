import { useStore } from '../store'
import { useT } from '../i18n'
import { ProbeField, ProbeGroup } from './ProbeFields'

/** Settings → Probe. Wiring reference + the probe MEASURING parameters (tool/plate,
 *  speeds, clearances) — set once here. The Probe window opened from the toolpath
 *  only picks the measurement TYPE and runs it. The grblHAL probe signal settings
 *  ($6/$19/$65) are rendered right after this by SettingsGuided. */
export function ProbeSettings(): JSX.Element {
  const t = useT()
  const p = useStore((s) => s.probeParams)
  const setP = useStore((s) => s.setProbeParams)
  const probeVerify = useStore((s) => s.probeVerify)
  const setProbeVerify = useStore((s) => s.setProbeVerify)
  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="font-display text-sm font-bold tracking-wider text-brand">{t('ui.probeSet.title')}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{t('ui.probeSet.intro')}</p>
      </div>

      {/* illustration + how it works */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-panel2 p-4 sm:flex-row sm:items-center">
        <TouchPlateDiagram />
        <ol className="flex-1 list-decimal space-y-1.5 pl-4 text-[12px] leading-relaxed text-slate-300">
          <li>{t('ui.probeSet.step1')}</li>
          <li>{t('ui.probeSet.step2')}</li>
          <li>{t('ui.probeSet.step3')}</li>
          <li>{t('ui.probeSet.step4')}</li>
        </ol>
      </div>

      {/* measuring parameters — moved here from the Probe window so it can stay a
          lean type-picker; these apply to every measurement type */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ProbeGroup title={t('ui.probeSet.toolPlate')}>
          <ProbeField label={t('ui.probe.tipDia')} unit="mm" step={0.1} value={p.tipDiameter} onChange={(v) => setP({ tipDiameter: v })} />
          <ProbeField label={t('ui.probeSet.plateZ')} unit="mm" step={0.1} value={p.thickness} onChange={(v) => setP({ thickness: v })} />
          <ProbeField label={t('ui.probeSet.plateXY')} unit="mm" step={0.1} value={p.edgePlate} onChange={(v) => setP({ edgePlate: v })} />
        </ProbeGroup>
        <ProbeGroup title={t('ui.probeSet.speeds')}>
          <ProbeField label={t('ui.probeSet.searchFeed')} unit="mm/min" value={p.searchFeed} onChange={(v) => setP({ searchFeed: v })} />
          <ProbeField label={t('ui.probeSet.latchFeed')} unit="mm/min" value={p.latchFeed} onChange={(v) => setP({ latchFeed: v })} />
          <ProbeField label={t('ui.probeSet.probeDist')} unit="mm" value={p.probeDistance} onChange={(v) => setP({ probeDistance: v })} />
          <ProbeField label={t('ui.probeSet.latchDist')} unit="mm" step={0.1} value={p.latchDistance} onChange={(v) => setP({ latchDistance: v })} />
        </ProbeGroup>
        <ProbeGroup title={t('ui.probeSet.clearances')}>
          <ProbeField label={t('ui.probeSet.xyClear')} unit="mm" value={p.xyClearance} onChange={(v) => setP({ xyClearance: v })} />
          <ProbeField label={t('ui.probeSet.depth')} unit="mm" value={p.depth} onChange={(v) => setP({ depth: v })} />
          <ProbeField label={t('ui.probeSet.approach')} unit="mm" value={p.approach} onChange={(v) => setP({ approach: v })} />
          <ProbeField label={t('ui.probeSet.retract')} unit="mm" value={p.retract} onChange={(v) => setP({ retract: v })} />
        </ProbeGroup>
      </div>

      {/* verification gate toggle — on for beginners, off for experienced users */}
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-panel2 p-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={probeVerify}
          onChange={(e) => setProbeVerify(e.target.checked)}
        />
        <span className="flex-1">
          <span className="text-[13px] font-semibold text-slate-200">{t('ui.probeSet.verifyGate')}</span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-400">{t('ui.probeSet.verifyGateHint')}</span>
        </span>
      </label>

      {/* safety note */}
      <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] leading-relaxed text-warn">
        ⚠ {t('ui.probeSet.safety')}
      </div>
    </div>
  )
}

/** Simple monochrome touch-plate diagram: end mill above a plate on the stock,
 *  clip wire to the spindle, Z-down arrow. */
function TouchPlateDiagram(): JSX.Element {
  return (
    <svg
      viewBox="0 0 160 150"
      className="h-36 w-40 shrink-0"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="62" y="6" width="36" height="20" rx="2" className="fill-slate-700 stroke-slate-500" strokeWidth="2" />
      <rect x="75" y="26" width="10" height="40" className="fill-slate-400 stroke-slate-300" strokeWidth="1.5" />
      <g className="stroke-brand" strokeWidth="2">
        <line x1="112" y1="30" x2="112" y2="72" />
        <path d="M112 72 l-4 -7 M112 72 l4 -7" />
      </g>
      <rect x="46" y="70" width="68" height="8" rx="1.5" className="fill-brand/30 stroke-brand" strokeWidth="2" />
      <rect x="30" y="78" width="100" height="34" className="fill-slate-800 stroke-slate-600" strokeWidth="2" />
      <line x1="14" y1="112" x2="146" y2="112" className="stroke-slate-600" strokeWidth="3" />
      <path d="M46 74 C 20 74, 20 16, 58 16" className="stroke-ok" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="58" cy="16" r="3" className="fill-ok" />
    </svg>
  )
}
