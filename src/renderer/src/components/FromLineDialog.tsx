import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { buildResume } from '../toolpath'
import { rotateGcode } from '../gcodeRotate'
import { useT } from '../i18n'

export function FromLineDialog(): JSX.Element | null {
  const t = useT()
  const open = useStore((s) => s.fromLineOpen)
  const setOpen = useStore((s) => s.setFromLineOpen)
  const connected = useStore((s) => s.connected)
  const gcode = useStore((s) => s.gcode)
  const rotationDeg = useStore((s) => s.rotationDeg)
  const activeLine = useStore((s) => s.activeLine)
  const setResumeLine = useStore((s) => s.setResumeLine)

  const lines = useMemo(() => (gcode ? gcode.split(/\r?\n/) : []), [gcode])
  const [lineStr, setLineStr] = useState('1')
  const [safeZ, setSafeZ] = useState('5')

  // default to the current/last executed line when opened
  useEffect(() => {
    if (open) setLineStr(String(activeLine >= 0 ? activeLine + 1 : 1))
  }, [open, activeLine])

  if (!open) return null

  const lineNo = Math.max(1, Math.min(lines.length, parseInt(lineStr) || 1))
  const targetIdx = lineNo - 1
  const targetText = lines[targetIdx] ?? ''

  const start = (): void => {
    if (!connected || !gcode) return
    const plan = buildResume(gcode, targetIdx, Number(safeZ) || 0)
    // seed the tracker's cursor at the chosen line so highlight/progress start there
    setResumeLine(targetIdx)
    // the highlight follows the ack count; tell the controller how the synthetic
    // preamble + file tail maps back onto the original file lines. Rotation keeps
    // line counts 1:1, so the mapping is unchanged — just rotate the streamed text.
    window.recta.startJob(rotateGcode(plan.gcode, rotationDeg), { fileLine: targetIdx, preambleLines: plan.preambleLines })
    setOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-panel shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-display text-sm font-bold tracking-wider text-brand">≡ {t('ui.fromline.title')}</span>
          <button className="btn text-xs" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-slate-500">{t('ui.fromline.line', { n: lines.length })}</span>
              <input
                type="number"
                min={1}
                max={lines.length}
                className="input w-28"
                value={lineStr}
                onChange={(e) => setLineStr(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-slate-500">Safe Z</span>
              <input
                type="number"
                step="any"
                className="input w-24"
                value={safeZ}
                onChange={(e) => setSafeZ(e.target.value)}
              />
            </label>
          </div>

          <div className="rounded-md border border-border bg-panel2 px-3 py-2 font-mono text-xs text-slate-300">
            <span className="text-slate-600">#{lineNo}</span> {targetText || '—'}
          </div>

          <p className="font-mono text-[10px] text-warn">{t('ui.fromline.warn')}</p>

          <button
            className="w-full rounded-md bg-ok py-2 font-semibold text-base transition hover:opacity-90 disabled:opacity-40"
            disabled={!connected || !gcode}
            onClick={start}
          >
            {t('ui.fromline.start', { n: lineNo })}
          </button>
        </div>
      </div>
    </div>
  )
}
