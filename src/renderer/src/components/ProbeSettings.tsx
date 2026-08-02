import { useStore } from '../store'
import { useT } from '../i18n'
import { ProbeField, ProbeGroup } from './ProbeFields'
import { EdgeOffsetDetail, TouchPlateDiagram } from './TouchPlateDiagram'

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
  const noPlate = useStore((s) => s.probeNoPlate)
  const setNoPlate = useStore((s) => s.setProbeNoPlate)
  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="font-display text-sm font-bold tracking-wider text-brand">{t('ui.probeSet.title')}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{t('ui.probeSet.intro')}</p>
      </div>

      {/* The two switches that change WHAT happens, side by side and up front —
          one decides whether the plate drawing below applies at all, the other
          whether measuring is locked until the probe proves it is wired. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-panel2 p-3">
          <input type="checkbox" className="mt-0.5" checked={noPlate} onChange={(e) => setNoPlate(e.target.checked)} />
          <span className="flex-1">
            <span className="text-[13px] font-semibold text-slate-200">{t('ui.probeSet.noPlate')}</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-400">{t('ui.probeSet.noPlateHint')}</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-panel2 p-3">
          <input type="checkbox" className="mt-0.5" checked={probeVerify} onChange={(e) => setProbeVerify(e.target.checked)} />
          <span className="flex-1">
            <span className="text-[13px] font-semibold text-slate-200">{t('ui.probeSet.verifyGate')}</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-400">{t('ui.probeSet.verifyGateHint')}</span>
          </span>
        </label>
      </div>

      {/* The plate as YOU built it. The drawing is dimensioned from the fields
          beside it, so filling them in IS the check that they went in the right
          boxes — and the boxes sit next to the drawing for the same reason.
          Dimmed when there is no plate: the numbers stay, they just stop being
          used, and a live control that changes nothing is a lie. */}
      <div className={`flex flex-col gap-5 rounded-lg border border-border bg-panel2 p-4 lg:flex-row ${noPlate ? 'opacity-40' : ''}`}>
        <div className="min-w-0 flex-[3]">
          <TouchPlateDiagram shape={{ thickness: p.thickness, railX: p.edgePlateX, railY: p.edgePlateY }} />
        </div>
        <div className="flex-[2] space-y-3">
          <ProbeGroup title={t('ui.probeSet.plateGroup')}>
            <ProbeField label={t('ui.probeSet.plateZ')} unit="mm" value={p.thickness} onChange={(v) => setP({ thickness: v })} />
            <ProbeField label={t('ui.probeSet.plateA')} unit="mm" value={p.edgePlateX} onChange={(v) => setP({ edgePlateX: v })} />
            <ProbeField label={t('ui.probeSet.plateB')} unit="mm" value={p.edgePlateY} onChange={(v) => setP({ edgePlateY: v })} />
          </ProbeGroup>
          {/* The letters only matter once the two rails differ, and then they matter
              completely — half a millimetre in the wrong box lands in the corner
              zero. So the note names the corner the drawing is drawn for. */}
          <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] leading-relaxed text-warn">
            {t('ui.probeSet.abNote')}
          </p>
          {/* Three steps, and all three are about the plate beside them. The list used
              to carry on into "open Probe, tap to verify, run Probe Z" — the other
              window's job, described in a place you have to leave to do it. */}
          <ol className="list-decimal space-y-1.5 pl-4 text-[12px] leading-relaxed text-slate-300">
            <li>{t('ui.probeSet.step1')}</li>
            <li>{t('ui.probeSet.step2')}</li>
            <li>{t('ui.probeSet.step3')}</li>
          </ol>
        </div>
      </div>

      {/* the sideways offset chain — the two numbers that stand between where the
          tool stops and where the material actually is */}
      <div className="flex flex-col gap-5 rounded-lg border border-border bg-panel2 p-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-[3]">
          {/* Drawn for X, so it shows rail a. Y is the same picture with b — one
              diagram twice would say nothing the first one did not. */}
          <EdgeOffsetDetail tipDiameter={p.tipDiameter} rail={noPlate ? 0 : p.edgePlateX} />
        </div>
        <div className="flex-[2] space-y-3">
          <ProbeGroup title={t('ui.probeSet.toolPlate')}>
            <ProbeField label={t('ui.probe.tipDia')} unit="mm" value={p.tipDiameter} onChange={(v) => setP({ tipDiameter: v })} />
          </ProbeGroup>
          <p className="text-[12px] leading-relaxed text-slate-400">{t('ui.probeSet.edgeHint')}</p>
        </div>
      </div>

      {/* measuring parameters — moved here from the Probe window so it can stay a
          lean type-picker; these apply to every measurement type */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ProbeGroup title={t('ui.probeSet.speeds')}>
          <ProbeField label={t('ui.probeSet.searchFeed')} unit="mm/min" value={p.searchFeed} onChange={(v) => setP({ searchFeed: v })} />
          <ProbeField label={t('ui.probeSet.latchFeed')} unit="mm/min" value={p.latchFeed} onChange={(v) => setP({ latchFeed: v })} />
          <ProbeField label={t('ui.probeSet.probeDist')} unit="mm" value={p.probeDistance} onChange={(v) => setP({ probeDistance: v })} />
          <ProbeField label={t('ui.probeSet.latchDist')} unit="mm" value={p.latchDistance} onChange={(v) => setP({ latchDistance: v })} />
        </ProbeGroup>
        <ProbeGroup title={t('ui.probeSet.clearances')}>
          <ProbeField label={t('ui.probeSet.xyClear')} unit="mm" value={p.xyClearance} onChange={(v) => setP({ xyClearance: v })} />
          <ProbeField label={t('ui.probeSet.depth')} unit="mm" value={p.depth} onChange={(v) => setP({ depth: v })} />
          <ProbeField label={t('ui.probeSet.approach')} unit="mm" value={p.approach} onChange={(v) => setP({ approach: v })} />
          <ProbeField label={t('ui.probeSet.retract')} unit="mm" value={p.retract} onChange={(v) => setP({ retract: v })} />
        </ProbeGroup>
      </div>

      {/* safety note */}
      <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] leading-relaxed text-warn">
        ⚠ {t('ui.probeSet.safety')}
      </div>
    </div>
  )
}
