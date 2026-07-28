import { useStore } from '../store'
import { useT } from '../i18n'
import { parseToolpath } from '../toolpath'
import { StockDiagram } from './StockDiagram'

/** Settings → Stock. Defines the raw-material block shown in the 3D view so the
 *  toolpath is seen cutting into the workpiece. Sits at the work origin. */
export function StockSettings(): JSX.Element {
  const t = useT()
  const stock = useStore((s) => s.stock)
  const setStock = useStore((s) => s.setStock)
  const gcode = useStore((s) => s.gcode)

  /** Size X/Y to the loaded program's footprint (+ a small margin), and read the
   *  XY zero off the same footprint: a program that runs entirely in +X zeroed on
   *  a left corner, one that straddles the origin zeroed on the centre, and so on.
   *  That is the honest answer for the loaded job — a corner picked by hand can put
   *  the block somewhere the program never goes. */
  const fitToProgram = (): void => {
    if (!gcode) return
    const p = parseToolpath(gcode)
    if (!p.hasGeometry) return
    const x = Math.ceil(p.max[0] - p.min[0] + 10)
    const y = Math.ceil(p.max[1] - p.min[1] + 10)
    if (x <= 0 || y <= 0) return
    // "straddles" = the path lies on both sides of the origin by a real margin, not
    // by a rounding crumb; tolerance scales with the part so it works at any size.
    const tx = Math.max(1, x * 0.05)
    const ty = Math.max(1, y * 0.05)
    const xSide = p.min[0] >= -tx ? 'L' : p.max[0] <= tx ? 'R' : 'C'
    const ySide = p.min[1] >= -ty ? 'F' : p.max[1] <= ty ? 'B' : 'C'
    const originCorner =
      xSide === 'C' || ySide === 'C' ? 'C' : ((ySide + xSide) as 'FL' | 'FR' | 'BL' | 'BR')
    setStock({ x, y, originCorner })
  }

  const num = (
    key: 'x' | 'y' | 'z' | 'diameter' | 'side' | 'sideH' | 'length',
    label: string,
    hint: string
  ): JSX.Element => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-200">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="any"
          min={0}
          className="input w-28 !py-1.5 text-sm disabled:opacity-40"
          value={stock[key]}
          disabled={!stock.enabled}
          onChange={(e) => setStock({ [key]: Number(e.target.value) })}
        />
        <span className="font-mono text-xs text-slate-500">mm</span>
      </div>
      <span className="text-[11px] leading-snug text-slate-500">{hint}</span>
    </label>
  )

  return (
    <div className="p-5">
      <div>
        <div className="font-display text-sm font-bold tracking-wider text-brand">{t('ui.stock.title')}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{t('ui.stock.intro')}</p>
      </div>

      {/* controls on the left, live drawing on the right — the panel is wide, and the
          picture carries what the hint text otherwise has to spell out */}
      <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
      {/* enable */}
      <button
        className="flex items-center gap-3"
        onClick={() => setStock({ enabled: !stock.enabled })}
        type="button"
      >
        {/* the same switch as everywhere else in Settings: green = on (see Toggle) */}
        <span
          className={`relative h-6 w-11 rounded-full transition ${stock.enabled ? 'bg-ok' : 'bg-border2'}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              stock.enabled ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </span>
        <span className="text-sm font-semibold text-slate-200">{t('ui.stock.show')}</span>
      </button>

      {/* mode: flat block (3-axis) vs rotary (4th axis / A) */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-slate-200">{t('ui.stock.shape')}</span>
        <div className="flex overflow-hidden rounded-md border border-border2" style={{ width: 'fit-content' }}>
          {(['box', 'rotary'] as const).map((m) => (
            <button
              key={m}
              disabled={!stock.enabled}
              onClick={() => setStock({ mode: m })}
              className={`px-4 py-1.5 text-sm transition disabled:opacity-40 ${
                stock.mode === m ? 'bg-brand text-[#020617] font-semibold' : 'bg-panel2 text-slate-300'
              }`}
            >
              {t(m === 'box' ? 'ui.stock.shapeBox' : 'ui.stock.shapeRotary')}
            </button>
          ))}
        </div>
        <span className="text-[11px] leading-snug text-slate-500">{t('ui.stock.shapeHint')}</span>
      </div>

      {stock.mode === 'box' ? (
        <>
          {/* dimensions */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {num('x', t('ui.stock.x'), t('ui.stock.xHint'))}
            {num('y', t('ui.stock.y'), t('ui.stock.yHint'))}
            {num('z', t('ui.stock.z'), t('ui.stock.zHint'))}
          </div>

          {/* Z0 face */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-200">{t('ui.stock.zOrigin')}</span>
            <div className="flex overflow-hidden rounded-md border border-border2" style={{ width: 'fit-content' }}>
              {(['top', 'bottom'] as const).map((o) => (
                <button
                  key={o}
                  disabled={!stock.enabled}
                  onClick={() => setStock({ zOrigin: o })}
                  className={`px-4 py-1.5 text-sm transition disabled:opacity-40 ${
                    stock.zOrigin === o ? 'bg-brand text-[#020617] font-semibold' : 'bg-panel2 text-slate-300'
                  }`}
                >
                  {t(o === 'top' ? 'ui.stock.top' : 'ui.stock.bottom')}
                </button>
              ))}
            </div>
            <span className="text-[11px] leading-snug text-slate-500">{t('ui.stock.zOriginHint')}</span>
          </div>

          {/* XY zero — picked on a little map of the part rather than from a list, so
              "front-left" needs no explaining. Laid out as the machine sees it:
              +X right, +Y away, operator standing at the bottom. */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-200">{t('ui.stock.xyOrigin')}</span>
            <div
              className="grid gap-1 rounded-md border border-border2 bg-panel2 p-1"
              style={{ width: 'fit-content', gridTemplateColumns: 'repeat(3, 2rem)', gridTemplateRows: 'repeat(3, 2rem)' }}
            >
              {(['BL', 'C', 'FL', 'BR', 'FR'] as const).map((c) => {
                const col = c === 'C' ? 2 : c.endsWith('L') ? 1 : 3
                const row = c === 'C' ? 2 : c.startsWith('B') ? 1 : 3
                return (
                  <button
                    key={c}
                    disabled={!stock.enabled}
                    onClick={() => setStock({ originCorner: c })}
                    title={t(`ui.stock.origin${c}`)}
                    style={{ gridColumn: col, gridRow: row }}
                    className={`flex items-center justify-center rounded text-[11px] transition disabled:opacity-40 ${
                      stock.originCorner === c
                        ? 'bg-ok font-bold text-[#020617]'
                        : 'bg-base text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {c}
                  </button>
                )
              })}
            </div>
            <span className="text-[11px] leading-snug text-slate-500">{t('ui.stock.xyOriginHint')}</span>
          </div>

          <button
            className="btn text-xs disabled:opacity-40"
            onClick={fitToProgram}
            disabled={!stock.enabled || !gcode}
          >
            {t('ui.stock.fit')}
          </button>
        </>
      ) : (
        <>
          {/* rotary cross-section: round bar vs square billet */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-200">{t('ui.stock.section')}</span>
            <div className="flex overflow-hidden rounded-md border border-border2" style={{ width: 'fit-content' }}>
              {(['round', 'square'] as const).map((sh) => (
                <button
                  key={sh}
                  disabled={!stock.enabled}
                  onClick={() => setStock({ rotaryShape: sh })}
                  className={`px-4 py-1.5 text-sm transition disabled:opacity-40 ${
                    stock.rotaryShape === sh ? 'bg-brand text-[#020617] font-semibold' : 'bg-panel2 text-slate-300'
                  }`}
                >
                  {t(sh === 'round' ? 'ui.stock.sectionRound' : 'ui.stock.sectionSquare')}
                </button>
              ))}
            </div>
            <span className="text-[11px] leading-snug text-slate-500">{t('ui.stock.sectionHint')}</span>
          </div>

          {/* rotary dimensions — Ø for round; width AND height for square, because a
              rectangular bar (50 × 60) is as common as a true square one */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {stock.rotaryShape === 'round' ? (
              num('diameter', t('ui.stock.diameter'), t('ui.stock.diameterHint'))
            ) : (
              <>
                {num('side', t('ui.stock.sideW'), t('ui.stock.sideWHint'))}
                {num('sideH', t('ui.stock.sideH'), t('ui.stock.sideHHint'))}
              </>
            )}
            {num('length', t('ui.stock.length'), t('ui.stock.lengthHint'))}
          </div>

          {/* rotary axis orientation — per job (long parts along Y, chuck along X…) */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-200">{t('ui.stock.rotaryAxis')}</span>
            <div className="flex overflow-hidden rounded-md border border-border2" style={{ width: 'fit-content' }}>
              {(['X', 'Y'] as const).map((a) => (
                <button
                  key={a}
                  disabled={!stock.enabled}
                  onClick={() => setStock({ rotaryAxis: a })}
                  className={`px-4 py-1.5 text-sm transition disabled:opacity-40 ${
                    stock.rotaryAxis === a ? 'bg-brand text-[#020617] font-semibold' : 'bg-panel2 text-slate-300'
                  }`}
                >
                  {t('ui.stock.rotaryAlong', { axis: a })}
                </button>
              ))}
            </div>
            <span className="text-[11px] leading-snug text-slate-500">{t('ui.stock.rotaryAxisHint')}</span>
          </div>
        </>
      )}
        </div>

        <aside className="flex flex-col items-center gap-3 self-start rounded-lg border border-border bg-panel2/40 p-4">
          <StockDiagram
            mode={stock.mode}
            rotaryShape={stock.rotaryShape}
            rotaryAxis={stock.rotaryAxis}
            zOrigin={stock.zOrigin}
            originCorner={stock.originCorner}
            x={stock.x}
            y={stock.y}
            z={stock.z}
            diameter={stock.diameter}
            side={stock.side}
            sideH={stock.sideH}
            length={stock.length}
            dimmed={!stock.enabled}
          />
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="inline-block h-2 w-2 rounded-full bg-ok" />
            {t('ui.stock.zeroLegend')}
          </div>
        </aside>
      </div>
    </div>
  )
}
