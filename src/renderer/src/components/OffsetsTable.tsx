import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useT, useLabel } from '../i18n'
import { setOffset, zeroWcs } from '@shared/grbl'

const DEFAULT_AXES = ['X', 'Y', 'Z']

// The six editable work coordinate systems, with their G10 P-index.
const WCS_ROWS: { name: string; p: number }[] = [
  { name: 'G54', p: 1 },
  { name: 'G55', p: 2 },
  { name: 'G56', p: 3 },
  { name: 'G57', p: 4 },
  { name: 'G58', p: 5 },
  { name: 'G59', p: 6 }
]

// Read-only reference rows reported by `$#` (positions/tool length, not WCS zeros).
const REF_ROWS = ['G28', 'G30', 'G92', 'TLO']

type OffsetMap = Record<string, number[]>

/** Work-offset table (like ioSender's Offsets tab): reads every coordinate system
 *  with `$#`, lets you edit G54–G59 cells directly (G10 L2) or zero a system at the
 *  current position (G10 L20). G28/G30/G92/TLO are shown for reference. */
export function OffsetsTable(): JSX.Element | null {
  const t = useT()
  const L = useLabel()
  const open = useStore((s) => s.offsetsOpen)
  const setOpen = useStore((s) => s.setOffsetsOpen)
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  const sdRunning = useStore((s) => s.sdRunning)
  const base = useStore((s) => (s.status?.state ?? '').split(':')[0])
  const activeWcs = useStore((s) => s.wcs)
  const infoAxes = useStore((s) => s.info.axes)
  const setSuppressLog = useStore((s) => s.setSuppressLog)
  const setParkPos = useStore((s) => s.setParkPos)
  const parkPos = useStore((s) => s.parkPos)
  const mpos = useStore((s) => s.status?.mpos ?? null)

  // `$#` reads and G10/G92 writes are Idle-only (mid-job they'd throw error:8 or
  // corrupt the program's coordinate system). Gate everything on "ready".
  const ready = connected && !jobRunning && !sdRunning && base === 'Idle'

  const axes = infoAxes.length ? infoAxes : DEFAULT_AXES
  const [data, setData] = useState<OffsetMap>({})
  const [reading, setReading] = useState(false)

  const read = (): void => {
    if (!ready) return
    setReading(true)
    setSuppressLog(true)
    const collected: OffsetMap = {}
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout>
    const finish = (): void => {
      off?.()
      clearTimeout(timer)
      setSuppressLog(false)
      setData(collected)
      setReading(false)
    }
    off = window.recta.onEvent((e) => {
      if (e.type !== 'line') return
      const line = e.data.trim()
      // [G54:0.000,0.000,0.000]  ·  [TLO:0.000]  ·  [PRB:...:1]
      const m = /^\[([A-Z0-9.]+):([-\d.,]+)(?::\d+)?\]$/.exec(line)
      if (m) collected[m[1]] = m[2].split(',').map(Number)
      else if (line === 'ok') finish()
    })
    timer = setTimeout(finish, 3000) // safety: stop if no 'ok'
    window.recta.send('$#')
  }

  /** Send a write, then re-read `$#` so the table reflects the new values. */
  const writeThenRead = (cmd: string): void => {
    if (!ready) return
    window.recta.send(cmd)
    setTimeout(read, 150)
  }

  /** Store the CURRENT machine position into a predefined position (G28.1 / G30.1).
   *  G30 doubles as the Park position: we ALSO remember it in the app (machine coords),
   *  so the park spot survives a restart even if the controller doesn't keep G30. */
  const storeHere = (name: string): void => {
    writeThenRead(`${name}.1`)
    if (name === 'G30' && mpos) setParkPos([mpos[0], mpos[1], mpos[2] ?? 0])
  }

  // auto-read when opened — but only once Idle (re-fires when the job finishes)
  useEffect(() => {
    if (open && ready) read()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready])

  if (!open) return null

  const zIndex = Math.max(0, axes.indexOf('Z')) // TLO lives on the tool-length (Z) axis

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col rounded-lg border border-border bg-panel shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="font-display text-sm font-bold tracking-wider text-brand">⊹ {t('ui.offsets.title')}</span>
          <button
            className="btn ml-auto text-xs"
            disabled={!ready || reading}
            onClick={read}
            title={t('ui.offsets.refresh')}
          >
            {reading ? L('ui.offsets.reading') : `↻ ${L('ui.offsets.refresh')}`}
          </button>
          <button className="btn text-xs" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-auto p-4">
          {!connected ? (
            <div className="p-8 text-center font-mono text-sm text-slate-500">{t('ui.offsets.notConnected')}</div>
          ) : (
            <>
              {!ready && (
                <div className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] leading-snug text-warn">
                  {t('ui.offsets.busy')}
                </div>
              )}
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-1">{t('ui.offsets.system')}</th>
                    {axes.map((a) => (
                      <th key={a} className="px-2 py-1 text-right">
                        {a}
                      </th>
                    ))}
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {WCS_ROWS.map((row) => {
                    const vals = data[row.name] ?? []
                    const active = row.name === activeWcs
                    return (
                      <tr key={row.name} className="border-t border-border/60">
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono font-bold">
                          <span className={active ? 'text-brand' : 'text-slate-300'}>
                            {active && <span className="mr-1">●</span>}
                            {row.name}
                          </span>
                          {active && <span className="ml-1 text-[10px] text-slate-500">{t('ui.offsets.active')}</span>}
                        </td>
                        {axes.map((a, i) => (
                          <td key={a} className="px-2 py-1.5">
                            <OffsetCell
                              value={vals[i]}
                              disabled={!ready}
                              onCommit={(v) => writeThenRead(setOffset(row.p, a, v))}
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right">
                          <button
                            className="rounded-md border border-brand/50 bg-panel2 px-2 py-1 text-[11px] font-semibold text-brand transition enabled:hover:bg-brand enabled:hover:text-[#020617] disabled:opacity-40"
                            disabled={!ready}
                            onClick={() => writeThenRead(zeroWcs(row.p, axes))}
                            title={t('ui.offsets.zeroTitle')}
                          >
                            {L('ui.offsets.zero')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}

                  {/* reference rows — reported but not directly settable here */}
                  {REF_ROWS.map((name) => {
                    // G30 doubles as the Park position: if the controller didn't report
                    // it (some builds drop G30 on restart) fall back to the app-saved one
                    const vals = data[name] ?? (name === 'G30' && parkPos ? parkPos : [])
                    const isTlo = name === 'TLO'
                    return (
                      <tr key={name} className="border-t border-border/60 text-slate-500">
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                          {name}
                          <span className="ml-1 text-[10px]">({t('ui.offsets.readonly')})</span>
                        </td>
                        {axes.map((a, i) => {
                          const v = isTlo ? (i === zIndex ? vals[0] : undefined) : vals[i]
                          return (
                            <td key={a} className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                              {v === undefined || Number.isNaN(v) ? '—' : v.toFixed(3)}
                            </td>
                          )
                        })}
                        <td className="px-2 py-1.5 text-right">
                          {(name === 'G28' || name === 'G30') && (
                            <button
                              className="rounded-md border border-border2 bg-panel2 px-2 py-1 text-[11px] text-slate-300 transition enabled:hover:border-brand enabled:hover:text-brand disabled:opacity-40"
                              disabled={!ready}
                              onClick={() => storeHere(name)}
                              title={t(name === 'G30' ? 'ui.offsets.setParkTitle' : 'ui.offsets.setHereTitle')}
                            >
                              {L('ui.offsets.setHere')}
                            </button>
                          )}
                          {name === 'G92' && (
                            <button
                              className="rounded-md border border-border2 bg-panel2 px-2 py-1 text-[11px] text-slate-300 transition enabled:hover:border-brand enabled:hover:text-brand disabled:opacity-40"
                              disabled={!ready}
                              onClick={() => writeThenRead('G92.1')}
                              title={t('ui.offsets.clearG92')}
                            >
                              {L('ui.offsets.clearG92')}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <p className="mt-3 rounded-md border border-brand/20 bg-brand/5 px-3 py-2 text-[11px] leading-snug text-slate-400">
                {t('ui.offsets.hint')}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** One editable offset cell — commits on Enter/blur, only if the value changed. */
function OffsetCell({
  value,
  disabled,
  onCommit
}: {
  value: number | undefined
  disabled?: boolean
  onCommit: (v: number) => void
}): JSX.Element {
  const shown = value === undefined || Number.isNaN(value) ? '' : value.toFixed(3)
  const [local, setLocal] = useState(shown)
  useEffect(() => setLocal(shown), [shown])

  const commit = (): void => {
    const n = parseFloat(local)
    if (local.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n)
    else setLocal(shown)
  }
  return (
    <input
      className="input !py-1 w-24 text-right font-mono text-xs disabled:opacity-40"
      value={local}
      inputMode="decimal"
      placeholder="—"
      disabled={disabled}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
