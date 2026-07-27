import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useT, useLabel } from '../i18n'
import { setOffset, zeroWcs } from '@shared/grbl'
import { InfoTip } from './InfoTip'
import { readOffsets, parkRow, applyOffsetsRead, hasPark, type OffsetMap } from '../offsets'

const DEFAULT_AXES = ['X', 'Y', 'Z']

// The editable work coordinate systems, with their G10 P-index. grblHAL can be built
// with three more beyond G59 (G59.1–G59.3, P7–P9) and reports them in `$#` when it
// has them — those are listed only when the controller actually answers with them,
// so a board without them shows a clean six-row table.
const WCS_ROWS: { name: string; p: number }[] = [
  { name: 'G54', p: 1 },
  { name: 'G55', p: 2 },
  { name: 'G56', p: 3 },
  { name: 'G57', p: 4 },
  { name: 'G58', p: 5 },
  { name: 'G59', p: 6 },
  { name: 'G59.1', p: 7 },
  { name: 'G59.2', p: 8 },
  { name: 'G59.3', p: 9 }
]

// Read-only reference rows reported by `$#` (positions/tool length, not WCS zeros).
// Each gets a plain-language name and an ⓘ explaining it — G30 in particular, since
// it IS the park position and nothing else in the UI says so. `note` marks the two
// rows that carry a closing caveat (the others have no `.note` key).
const REF_ROWS: { name: string; note?: boolean }[] = [
  { name: 'G28' },
  { name: 'G30', note: true },
  { name: 'G92', note: true },
  { name: 'TLO', note: true }
]

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
    void readOffsets().then((map) => {
      setData(map)
      applyOffsetsRead(map) // board's G30 wins — see offsets.ts
      setReading(false)
    })
  }

  /** Send a write, then re-read `$#` so the table reflects the new values. */
  const writeThenRead = (cmd: string): void => {
    if (!ready) return
    window.recta.send(cmd)
    setTimeout(read, 150)
  }

  /** Store the CURRENT machine position into a predefined position (G28.1 / G30.1).
   *  For G30 the app's copy is set straight away so Park arms without waiting; the
   *  follow-up `$#` read then re-seats it from the board, which owns it. */
  const storeHere = (name: string): void => {
    writeThenRead(`${name}.1`)
    // machine zero counts as "no park" everywhere else, so don't arm Park with it here
    if (name === 'G30' && mpos) {
      const p: [number, number, number] = [mpos[0], mpos[1], mpos[2] ?? 0]
      setParkPos(hasPark(p) ? p : null)
    }
  }

  // auto-read when opened — but only once Idle (re-fires when the job finishes)
  useEffect(() => {
    if (open && ready) read()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready])

  if (!open) return null

  const zIndex = Math.max(0, axes.indexOf('Z')) // TLO lives on the tool-length (Z) axis
  // the extra G59.x systems only exist on some builds — list them once seen in `$#`
  const wcsRows = WCS_ROWS.filter((r) => r.p <= 6 || data[r.name] !== undefined)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-lg border border-border bg-panel shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="font-display text-sm font-bold tracking-wider text-brand">⊹ {t('ui.offsets.title')}</span>
          <button
            className="btn ml-auto h-7 px-2.5 py-0 text-xs"
            disabled={!ready || reading}
            onClick={read}
            title={t('ui.offsets.refresh')}
          >
            {reading ? L('ui.offsets.reading') : `↻ ${L('ui.offsets.refresh')}`}
          </button>
          <button className="btn h-7 w-7 px-0 py-0 text-xs leading-none" onClick={() => setOpen(false)}>
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
              {/* NOT overflow-hidden: the ⓘ popovers have to escape the table box.
                  The header cells round their own outer corners instead. */}
              <div className="rounded-lg border border-border">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="rounded-tl-lg border-b border-border bg-panel2/60 px-3 py-2 text-left font-medium">
                        <span className="flex items-center gap-1.5">
                          {t('ui.offsets.system')}
                          <InfoTip
                            title={t('ui.wcs.title')}
                            body={[t('ui.wcs.p1'), t('ui.wcs.p2')]}
                            note={t('ui.wcs.p3')}
                            triggerTitle={t('ui.wcs.q')}
                          />
                        </span>
                      </th>
                      {axes.map((a) => (
                        <th key={a} className="border-b border-border bg-panel2/60 px-2 py-2 text-center font-medium">
                          {a}
                        </th>
                      ))}
                      <th className="w-px rounded-tr-lg border-b border-border bg-panel2/60 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {wcsRows.map((row, ri) => {
                      const vals = data[row.name] ?? []
                      const active = row.name === activeWcs
                      // The active system lights up as a WHOLE row (tint + left accent bar) —
                      // the row itself is the indicator, so no per-cell decoration is needed.
                      // The last WCS row skips its rule; the reference group draws its own.
                      const cell = `px-2 py-1.5 ${active ? 'bg-brand/10' : ''} ${
                        ri === wcsRows.length - 1 ? '' : 'border-b border-border/60'
                      }`
                      return (
                        <tr key={row.name}>
                          <td
                            className={`${cell} whitespace-nowrap !px-3 font-mono font-bold ${
                              active ? 'text-brand shadow-[inset_3px_0_0_0_#22d3ee]' : 'text-slate-300'
                            }`}
                          >
                            {row.name}
                            {active && (
                              <span className="ml-2 rounded border border-brand/40 px-1.5 py-px align-middle font-sans text-[9px] font-semibold uppercase tracking-wider text-brand">
                                {t('ui.offsets.active')}
                              </span>
                            )}
                          </td>
                          {axes.map((a, i) => (
                            <td key={a} className={cell}>
                              <OffsetCell
                                value={vals[i]}
                                disabled={!ready}
                                onCommit={(v) => writeThenRead(setOffset(row.p, a, v))}
                              />
                            </td>
                          ))}
                          <td className={`${cell} !px-3 text-right`}>
                            <RowButton
                              label={L('ui.offsets.zero')}
                              title={t('ui.offsets.zeroTitle')}
                              disabled={!ready}
                              onClick={() => writeThenRead(zeroWcs(row.p, axes))}
                            />
                          </td>
                        </tr>
                      )
                    })}

                    {/* group header — says out loud that what follows is a different
                        kind of thing (fixed table spots, not work zeros) */}
                    <tr>
                      <td
                        colSpan={axes.length + 2}
                        className="border-y border-border bg-panel2/60 px-3 py-1.5 leading-tight"
                      >
                        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-slate-500">
                          {t('ui.offsets.refGroup')}
                        </span>
                        <span className="ml-2 text-[10px] text-slate-600">{t('ui.offsets.refGroupSub')}</span>
                      </td>
                    </tr>

                    {/* reference rows — reported but not directly settable here */}
                    {REF_ROWS.map(({ name, note }, ri) => {
                      // G30 shows the spot PARK WILL ACTUALLY GO TO — the app's saved
                      // one, since this controller loses G30 on restart. Anything else
                      // and the table would read 0,0,0 while the head drives elsewhere.
                      const isG30 = name === 'G30'
                      const { vals, fromApp } = isG30
                        ? parkRow(data[name], parkPos)
                        : { vals: data[name] ?? [], fromApp: false }
                      const isTlo = name === 'TLO'
                      const k = `ui.offsets.${name.toLowerCase()}` // g28 / g30 / g92 / tlo
                      const cell = `px-2 py-1.5 ${
                        ri === REF_ROWS.length - 1 ? '' : 'border-b border-border/60'
                      }`
                      return (
                        <tr key={name} className="text-slate-500">
                          <td className={`${cell} whitespace-nowrap !px-3`}>
                            <span className="flex items-center gap-1.5 font-mono leading-none">
                              {name}
                              <InfoTip
                                title={`${name} · ${t(`${k}.name`)}`}
                                body={[t(`${k}.p1`), t(`${k}.p2`)]}
                                note={note ? t(`${k}.note`) : undefined}
                                triggerTitle={t(`${k}.name`)}
                                // always upward: these are the LAST rows in the dialog, so
                                // a downward panel pushes the body past its height and the
                                // scrollbar that appears shifts the whole table sideways.
                                // Opening over the (taller) rows above costs nothing.
                                placement="top-left"
                              />
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-none text-slate-600">
                              {t(`${k}.name`)}
                              {/* says out loud that this number lives in the app, not in
                                  the controller — the whole point of the G30 row */}
                              {fromApp && (
                                <span className="rounded border border-brand/40 px-1 py-px font-sans text-[9px] font-semibold uppercase tracking-wide text-brand">
                                  {t('ui.offsets.g30.appStored')}
                                </span>
                              )}
                            </span>
                          </td>
                          {axes.map((a, i) => {
                            // TLO is reported per-axis on this firmware ([TLO:0,0,0,0]),
                            // but plain grbl sends a single number ([TLO:0.000]) meaning
                            // the tool-length axis — handle both rather than assume.
                            const v = isTlo && vals.length <= 1 ? (i === zIndex ? vals[0] : undefined) : vals[i]
                            return (
                              <td key={a} className={`${cell} text-center font-mono text-xs tabular-nums`}>
                                {v === undefined || Number.isNaN(v) ? '—' : v.toFixed(3)}
                              </td>
                            )
                          })}
                          <td className={`${cell} !px-3 text-right`}>
                            {(name === 'G28' || name === 'G30') && (
                              <RowButton
                                label={L('ui.offsets.setHere')}
                                title={t(name === 'G30' ? 'ui.offsets.setParkTitle' : 'ui.offsets.setHereTitle')}
                                disabled={!ready}
                                onClick={() => storeHere(name)}
                              />
                            )}
                            {name === 'G92' && (
                              <RowButton
                                label={L('ui.offsets.clearG92')}
                                title={t('ui.offsets.clearG92')}
                                disabled={!ready}
                                onClick={() => writeThenRead('G92.1')}
                              />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

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

/** The one action button used by every row (Zero here / Set / Clear G92). Same size,
 *  same weight, same hover for all of them — the table stays calm and the only accent
 *  in it is the highlighted active row. */
function RowButton({
  label,
  title,
  disabled,
  onClick
}: {
  label: string
  title?: string
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className="w-[92px] rounded-md border border-border2 bg-panel2 py-1 text-[11px] font-medium text-slate-300 transition enabled:hover:border-brand enabled:hover:text-brand disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
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
      className="input !px-2 !py-1 w-full min-w-[5.5rem] text-center font-mono text-xs tabular-nums disabled:opacity-40"
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
