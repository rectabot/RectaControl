import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { usesRotary } from '../toolpath'
import { useT } from '../i18n'

/** On loading a program that uses the A axis, offer to show a rotary workpiece
 *  (cylinder or square billet + its size) so the toolpath wraps onto it. Skipped
 *  if rotary stock is already set up. */
export function RotaryLoadPrompt(): JSX.Element | null {
  const t = useT()
  const filename = useStore((s) => s.filename)
  const gcode = useStore((s) => s.gcode)
  const stock = useStore((s) => s.stock)
  const setStock = useStore((s) => s.setStock)

  const [open, setOpen] = useState(false)
  const [shape, setShape] = useState<'round' | 'square'>('round')
  const [size, setSize] = useState(50)
  const lastPrompted = useRef<string | null>(null)

  useEffect(() => {
    if (!filename || !gcode) return
    if (lastPrompted.current === filename) return
    if (!usesRotary(gcode)) return
    lastPrompted.current = filename
    // already showing rotary stock → nothing to ask
    if (stock.mode === 'rotary' && stock.enabled) return
    setShape(stock.rotaryShape)
    setSize(stock.rotaryShape === 'round' ? stock.diameter : stock.side)
    setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename, gcode])

  if (!open) return null

  const apply = (): void => {
    setStock({
      enabled: true,
      mode: 'rotary',
      rotaryShape: shape,
      ...(shape === 'round' ? { diameter: size } : { side: size })
    })
    setOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-panel p-5 shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-sm font-bold text-brand">{t('ui.rotaryPrompt.title')}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{t('ui.rotaryPrompt.body')}</p>

        <div className="mt-4 flex flex-col gap-3">
          <div
            className="flex overflow-hidden rounded-md border border-border2"
            style={{ width: 'fit-content' }}
          >
            {(['round', 'square'] as const).map((sh) => (
              <button
                key={sh}
                onClick={() => setShape(sh)}
                className={`px-4 py-1.5 text-sm transition ${
                  shape === sh ? 'bg-brand text-[#020617] font-semibold' : 'bg-panel2 text-slate-300'
                }`}
              >
                {t(sh === 'round' ? 'ui.rotaryPrompt.cyl' : 'ui.rotaryPrompt.block')}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <span className="w-24">{t(shape === 'round' ? 'ui.stock.diameter' : 'ui.stock.side')}</span>
            <input
              type="number"
              step="any"
              min={1}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="input w-28 !py-1.5 text-sm"
            />
            <span className="font-mono text-xs text-slate-500">mm</span>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn text-sm" onClick={() => setOpen(false)}>
            {t('ui.rotaryPrompt.no')}
          </button>
          <button className="btn border-brand text-sm text-brand" onClick={apply}>
            {t('ui.rotaryPrompt.show')}
          </button>
        </div>
      </div>
    </div>
  )
}
