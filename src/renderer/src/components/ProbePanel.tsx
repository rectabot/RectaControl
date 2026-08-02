import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useT, useLabel } from '../i18n'
import { ProbeDiagram, type ProbeSel } from './ProbeDiagram'
import { runZ, runEdge, runCorner, runCornerExternal3, runSkew } from '../probeRun'
import { ProbeField } from './ProbeFields'
import { readOffsets, applyOffsetsRead } from '../offsets'
import { ProbeIcon } from './icons'


/** Compact Probe window (opened by the toolpath Probe button). It only PICKS the
 *  measurement type (Z / edge-corner / centre / angle) and runs it — the measuring
 *  parameters live in Settings → Probe. It opens over the visualizer (DRO + Jog stay
 *  on the left for positioning) and remembers the last-used type (store.probeMode). */
export function ProbePanel(): JSX.Element | null {
  const t = useT()
  const L = useLabel()
  const open = useStore((s) => s.probeOpen)
  const setOpen = useStore((s) => s.setProbeOpen)
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  const sdRunning = useStore((s) => s.sdRunning)
  const base = useStore((s) => (s.status?.state ?? '').split(':')[0])
  const pins = useStore((s) => s.status?.pins ?? null)
  const p = useStore((s) => s.probeParams)
  const rotationDeg = useStore((s) => s.rotationDeg)
  const setRotationDeg = useStore((s) => s.setRotationDeg)
  const probeVerify = useStore((s) => s.probeVerify)
  const noPlate = useStore((s) => s.probeNoPlate)
  const openSettingsAt = useStore((s) => s.openSettingsAt)

  /** Touching the conductive workpiece itself: nothing sits between the tool and
   *  the surface, so there is nothing to subtract. Z reads 0 at the top face, and
   *  sideways only half the tool remains between the contact and the edge. Done by
   *  handing the cycles a thickness of zero rather than by branching inside them —
   *  it is the same measurement, with one term gone. */
  const pp = noPlate ? { ...p, thickness: 0 } : p

  const ready = connected && !jobRunning && !sdRunning && base === 'Idle'
  const triggered = !!pins && pins.includes('P')

  // safety verification: an open→triggered rising edge unlocks measuring
  const [verified, setVerified] = useState(false)
  const sawOpen = useRef(false)
  useEffect(() => {
    if (!triggered) sawOpen.current = true
    else if (sawOpen.current) setVerified(true)
  }, [triggered])
  // re-arm on EVERY open: the panel stays mounted (returns null when closed), so
  // without this a past verification would carry over. Requiring a fresh tap each
  // time the window opens is deliberate — it re-confirms the sonde is still wired.
  // Seed from the CURRENT pin so a probe already touching the plate can't auto-pass
  // (must go open→triggered), same stuck-probe protection as the first open.
  useEffect(() => {
    if (!open) return
    const pins = useStore.getState().status?.pins
    setVerified(false)
    sawOpen.current = !(pins && pins.includes('P'))
  }, [open])

  const tab = useStore((s) => s.probeMode) // remembered across opens
  const setTab = useStore((s) => s.setProbeMode)
  const [edgeInternal, setEdgeInternal] = useState(false)
  const [edgeTouchPlate, setEdgeTouchPlate] = useState(true)
  const [sel, setSel] = useState<ProbeSel | null>(null)
  const [rotSpacing, setRotSpacing] = useState(50)
  const [measuredAngle, setMeasuredAngle] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  if (!open) return null
  // gate on the tap-to-unlock verification only when it's required (default). Turned
  // off in Settings → Probe for experienced users who read the footer probe pin.
  const canRun = ready && (!probeVerify || verified) && !busy

  const finish = (r: { ok: boolean; error?: string; note?: string }): void => {
    setBusy(false)
    setStep('')
    setResult({ ok: r.ok, msg: r.ok ? r.note || t('ui.probe.done') : t('ui.probe.holeErr', { msg: r.error || '' }) })
    // Probing moved the work origin — go and find out where it landed.
    //
    // `G10 L20` changes the board's G54 and the board says nothing about it: no line
    // comes back, and `$#` is otherwise only read on connect or by hand from the
    // offsets table. So the 3D view went on drawing the toolpath, the grid and the
    // stock around the OLD origin while the machine worked from the new one — which
    // is what Filip saw as the toolpath not matching the motion. The DRO was right
    // throughout, because its work coordinates are computed by the board.
    //
    // Fresh read, no age allowance: the whole point is that what we hold is stale.
    if (r.ok) void readOffsets().then(applyOffsetsRead)
  }
  const guard = async (fn: () => Promise<{ ok: boolean; error?: string; note?: string }>): Promise<void> => {
    if (!canRun) return
    setBusy(true)
    setResult(null)
    finish(await fn())
  }

  // rotation mode has its own handler (not the shared guard) so it can capture the
  // numeric angle for the "apply to G-code" step
  const runRotate = (): void => {
    if (!canRun) return
    setBusy(true)
    setResult(null)
    setMeasuredAngle(null)
    void (async () => {
      // same front-left corner as the three-axis zero, and the same plate rails —
      // the skew cycle IS that cycle plus one more touch further along the edge
      const plate = noPlate || !edgeTouchPlate ? { x: 0, y: 0 } : { x: p.edgePlateX, y: p.edgePlateY }
      const r = await runSkew(1, 1, rotSpacing, pp, plate, setStep)
      // through the shared finish, not alongside it: this cycle sets the corner zero
      // like any other, so it owes the 3D view the same fresh read of `$#`
      finish(r)
      if (r.ok && r.angle !== undefined) setMeasuredAngle(r.angle)
    })()
  }

  const runEdgeOrCorner = (): void => {
    if (!sel) return
    // no plate → nothing to add beyond the tool radius, whatever the checkbox says
    const plate = noPlate || !edgeTouchPlate ? { x: 0, y: 0 } : { x: p.edgePlateX, y: p.edgePlateY }
    void guard(() => {
      // a single edge only ever touches one rail — the one for that axis
      if (sel.kind === 'edge') return runEdge(sel.axis, sel.dir, pp, sel.axis === 'X' ? plate.x : plate.y)
      // external corner = full 3-axis (Z + X + Y); internal = X + Y only
      return edgeInternal
        ? runCorner(sel.xDir, sel.yDir, pp, plate)
        : runCornerExternal3(sel.xDir, sel.yDir, pp, plate, setStep)
    })
  }

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-3">
      <div className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-glow">
        {/* header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="flex items-center gap-2 font-display text-sm font-bold tracking-wider text-brand">
            <ProbeIcon className="h-4 w-4" /> {L('ui.vc.probe')}
          </span>
          <button className="btn text-xs" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        {/* body — type picker + selected type's controls (params live in Settings) */}
        <div className="min-h-0 space-y-3 overflow-y-auto p-4">
          {/* compact safety verification (tap the probe once to unlock) */}
          <div className="flex items-center gap-2 rounded-md border border-border bg-panel2 px-2.5 py-1.5">
            <Dot done={verified} />
            <span className={`h-2.5 w-2.5 rounded-full ${triggered ? 'bg-ok shadow-glow' : 'bg-slate-600'}`} />
            <span className="font-mono text-[11px] text-slate-300">
              {t('ui.probe.pinState')}:{' '}
              <span className={triggered ? 'font-bold text-ok' : 'text-slate-400'}>
                {triggered ? t('ui.probe.pinTriggered') : t('ui.probe.pinOpen')}
              </span>
            </span>
            <span className="ml-auto text-[10px] leading-tight text-slate-400">
              {!probeVerify ? (
                <span className="text-slate-500">{t('ui.probe.verifyOff')}</span>
              ) : verified ? (
                <span className="font-semibold text-ok">✓ {t('ui.probe.verified')}</span>
              ) : (
                t('ui.probe.verifyShort')
              )}
            </span>
          </div>

          {/* Direct-touch is a different measurement, not a preference, so it says
              so where the measuring happens — not only back in Settings. */}
          {noPlate && (
            <div className="rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn">
              {t('ui.probe.noPlateOn')}
            </div>
          )}

          {/* mode tabs */}
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border2">
            {([['z', 'z'], ['edge', 'edge'], ['rotate', 'rotate']] as const).map(([m, key]) => (
              <button
                key={m}
                onClick={() => {
                  setTab(m)
                  setResult(null)
                }}
                className={`py-1.5 font-mono text-xs transition ${
                  tab === m ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-400 hover:text-slate-200'
                }`}
              >
                {t(`ui.probe.mode.${key}`)}
              </button>
            ))}
          </div>

          {/* No "what to do with it" row: probing sets the work zero in the
              coordinate system the DRO has active. See probeRun.ts for why the
              three-way choice went away. */}

          {/* per-mode body */}
          {tab === 'z' && (
            <ModeCard title={t('ui.probe.mode.z')} hint={t('ui.probe.zHint')}>
              <RunBtn disabled={!canRun} onClick={() => void guard(() => runZ(pp))} label={`${t('ui.probe.runZ')} ↓`} />
            </ModeCard>
          )}

          {tab === 'edge' && (
            <ModeCard
              title={t('ui.probe.mode.edge')}
              hint={sel?.kind === 'corner' && !edgeInternal ? t('ui.probe.corner3Hint') : t('ui.probe.edgeHint')}
            >
              <Toggle
                left={t('ui.probe.external')}
                right={t('ui.probe.internal')}
                value={edgeInternal}
                onChange={(v) => {
                  setEdgeInternal(v)
                  setSel(null)
                }}
              />
              {/* With no plate in the setup at all, this checkbox has nothing to
                  offer and its remembered state would only mislead. */}
              {!noPlate && (
                <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
                  <input type="checkbox" checked={edgeTouchPlate} onChange={(e) => setEdgeTouchPlate(e.target.checked)} />
                  {t('ui.probe.useTouchPlate')}
                  {edgeTouchPlate && (
                    <span className="font-mono text-slate-500">
                      (a {p.edgePlateX} · b {p.edgePlateY} mm)
                    </span>
                  )}
                </label>
              )}
              {/* External corners: front-left only. That corner sets all three axes
                  at once, and picking the wrong one does not look wrong — it shifts
                  the entire cut by the width of the stock, into the table beside a
                  workpiece the tool never reaches. CAM puts the origin front-left and
                  the homing corner is already locked there. Edges stay open on all
                  four sides, and so does the internal corner: those zero one axis or
                  a pocket, where the operator is picking a feature, not an origin. */}
              <div className="my-3 flex justify-center">
                <ProbeDiagram
                  internal={edgeInternal}
                  selectedKey={sel?.key ?? null}
                  onSelect={setSel}
                  frontLeftOnly={!edgeInternal}
                />
              </div>
              <p className="mb-2 text-center text-[11px] text-slate-400">
                {sel ? t('ui.probe.placeDot') : t(edgeInternal ? 'ui.probe.pickHint' : 'ui.probe.pickHintFL')}
              </p>
              <RunBtn
                disabled={!canRun || !sel}
                onClick={runEdgeOrCorner}
                label={
                  busy
                    ? `${t('ui.probe.holeRunning')} ${step}`
                    : sel?.kind === 'corner'
                      ? t('ui.probe.runCorner')
                      : t('ui.probe.runEdge')
                }
              />
            </ModeCard>
          )}

          {tab === 'rotate' && (
            <ModeCard title={t('ui.probe.mode.rotate')} hint={t('ui.probe.rotateHint')}>
              {/* No edge to pick: the cycle starts at the front-left corner, like
                  the three-axis zero, and measures along the front edge from there. */}
              <div className="mb-3 flex justify-center">
                <ProbeDiagram internal={false} selectedKey="c-fl" onSelect={() => {}} frontLeftOnly />
              </div>
              <p className="mb-2 text-center text-[11px] text-slate-400">{t('ui.probe.placeDot')}</p>
              <div className="mb-3 flex justify-center">
                <ProbeField label={t('ui.probe.spacing')} unit="mm" value={rotSpacing} onChange={setRotSpacing} />
              </div>
              <RunBtn
                disabled={!canRun}
                onClick={runRotate}
                label={busy ? `${t('ui.probe.holeRunning')} ${step}` : t('ui.probe.runRotate')}
              />

              {/* measured → apply to the G-code (software rotation about work origin) */}
              {measuredAngle !== null && (
                <div className="mt-3 space-y-2 rounded-md border border-border bg-base p-2.5">
                  <div className="text-center font-mono text-lg text-brand">∠ {measuredAngle.toFixed(3)}°</div>
                  <RunBtn disabled={false} onClick={() => setRotationDeg(measuredAngle)} label={t('ui.rot.apply')} />
                  <button
                    className="w-full text-[11px] text-slate-400 transition hover:text-slate-200"
                    onClick={() => setRotationDeg(-measuredAngle)}
                  >
                    {t('ui.rot.applyInv')}
                  </button>
                  <p className="text-[10px] leading-relaxed text-slate-500">{t('ui.rot.applyHint')}</p>
                </div>
              )}

              {/* current applied rotation + clear */}
              {!!rotationDeg && (
                <div className="mt-2 flex items-center justify-between rounded-md border border-warn/40 bg-panel2 px-2.5 py-1.5 text-[11px] text-warn">
                  <span className="font-mono">{t('ui.rot.active', { deg: rotationDeg.toFixed(3) })}</span>
                  <button className="rounded px-1.5 hover:bg-warn/20" onClick={() => setRotationDeg(0)}>
                    {t('ui.rot.clear')}
                  </button>
                </div>
              )}
            </ModeCard>
          )}

          {/* result + warnings */}
          {result && (
            <div className={`rounded-md px-3 py-2 text-xs font-semibold ${result.ok ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}>
              {result.ok ? '✓ ' : ''}
              {result.msg}
            </div>
          )}
          {!ready && <p className="text-[11px] text-warn">{t('ui.probe.notReady')}</p>}
          <p className="font-mono text-[10px] leading-relaxed text-danger/80">⚠ {t('ui.probe.warn')}</p>
          <button
            className="w-full text-center text-[11px] text-slate-500 transition hover:text-brand"
            onClick={() => openSettingsAt('probe')}
          >
            {t('ui.probe.paramsLink')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── small pieces ─────────────────────────────────────────────────────────────

function Toggle({
  left,
  right,
  value,
  onChange
}: {
  left: string
  right: string
  value: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="flex overflow-hidden rounded-md border border-border2">
      {[
        [false, left],
        [true, right]
      ].map(([v, lbl]) => (
        <button
          key={String(v)}
          onClick={() => onChange(v as boolean)}
          className={`flex-1 py-1.5 font-mono text-xs transition ${
            value === v ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-400 hover:text-slate-200'
          }`}
        >
          {lbl as string}
        </button>
      ))}
    </div>
  )
}

function ModeCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-panel2 p-3">
      <div className="mb-1 text-xs font-semibold text-slate-200">{title}</div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-400">{hint}</p>
      {children}
    </div>
  )
}

function RunBtn({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }): JSX.Element {
  return (
    <button
      className="w-full rounded-md bg-brand py-2 font-semibold text-[#020617] transition enabled:hover:bg-brandDark disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function Dot({ done }: { done: boolean }): JSX.Element {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
        done ? 'bg-ok text-[#020617]' : 'border border-border2 text-slate-400'
      }`}
    >
      {done ? '✓' : '1'}
    </span>
  )
}
