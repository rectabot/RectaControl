import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { SettingsGuided } from './SettingsGuided'
import { FirmwareFlash } from './FirmwareFlash'
import { AppUpdate } from './AppUpdate'
import { BoardDiagram } from './BoardDiagram'
import { ErrorsReference } from './ErrorsReference'
import { ThemeSettings } from './ThemeSettings'
import { ControlsSettings } from './ControlsSettings'
import { ProbeSettings } from './ProbeSettings'
import { StockSettings } from './StockSettings'
import { Diagnostics } from './Diagnostics'
import { LanguageSelect } from './LanguageSelect'
import { GearIcon, UploadIcon, ChipIcon, SearchIcon, SectionIcon, ListIcon, AlertIcon, ThemeIcon, ControlsIcon, ProbeIcon, StockIcon, PulseIcon } from './icons'
import { SECTIONS } from '@shared/machine-config'

interface Row {
  num: number
  value: string
}

export function SettingsBrowser(): JSX.Element | null {
  const t = useT()
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const settingsSection = useStore((s) => s.settingsSection)
  const clearSettingsSection = useStore((s) => s.clearSettingsSection)
  const connected = useStore((s) => s.connected)
  const axes = useStore((s) => s.info.axes)
  // `$$` is only accepted when the machine is Idle (otherwise grblHAL replies
  // error:8 "only allowed when idle"). Gate the read on the current state so we
  // never spam an error just because Settings was opened mid-job.
  const base = useStore((s) => (s.status?.state ?? '').split(':')[0])
  const busy = base === 'Run' || base === 'Jog' || base === 'Hold' || base === 'Home' || base === 'Door'

  // selected sidebar category: a section id, or one of the specials
  // 'advanced' | 'firmware' | 'board' | 'errors'
  const [cat, setCat] = useState<string>('spindle')
  const [rows, setRows] = useState<Row[]>([])
  const [reading, setReading] = useState(false)
  const [query, setQuery] = useState('')
  // Where the Firmware pane portals its action row. Element STATE, not a ref, so the
  // portal re-renders the moment the node exists — and declared up here with the
  // other hooks, above the `if (!open) return null` further down: a hook after an
  // early return changes the hook count between renders and React throws.
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // honour a deep-link (e.g. the Probe window's "params in Settings" link) by
  // jumping to that category on open, then clear it so it doesn't re-fire
  useEffect(() => {
    if (settingsSection) {
      setCat(settingsSection)
      clearSettingsSection()
    }
  }, [settingsSection, clearSettingsSection])

  const valMap = useMemo(() => Object.fromEntries(rows.map((r) => [r.num, r.value])), [rows])

  /** Send a setting and reflect it locally (keeps both tabs in sync without a re-read). */
  const write = (numSetting: number, value: string | number): void => {
    const val = String(value)
    window.recta.send(`$${numSetting}=${val}`)
    setRows((rs) => {
      const has = rs.some((r) => r.num === numSetting)
      const next = has
        ? rs.map((r) => (r.num === numSetting ? { ...r, value: val } : r))
        : [...rs, { num: numSetting, value: val }]
      return next.sort((a, b) => a.num - b.num)
    })
  }

  const read = (): void => {
    if (!connected || busy) return
    const collected: Record<number, string> = {}
    setReading(true)
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout>
    const finish = (): void => {
      off?.()
      clearTimeout(timer)
      setReading(false)
      setRows(
        Object.entries(collected)
          .map(([k, v]) => ({ num: Number(k), value: v }))
          .sort((a, b) => a.num - b.num)
      )
    }
    off = window.recta.onEvent((e) => {
      if (e.type !== 'line') return
      const t = e.data.trim()
      const m = /^\$(\d+)=(.*)$/.exec(t)
      if (m) collected[Number(m[1])] = m[2]
      else if (t === 'ok') finish()
    })
    timer = setTimeout(finish, 3000) // safety: stop if no 'ok'
    window.recta.send('$$')
  }

  // auto-read when opened while connected — but only once Idle. If Settings is
  // opened mid-job, `busy` holds the read off; when the machine returns to Idle
  // this effect re-fires (base changed) and reads then.
  useEffect(() => {
    if (open && connected && !busy && rows.length === 0) read()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected, busy])

  if (!open) return null

  const exportSettings = (): void => {
    const text = rows.map((r) => `$${r.num}=${r.value}`).join('\n') + '\n'
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'rectabot-settings.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importSettings = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    if (!f || !connected) return
    const text = await f.text()
    for (const line of text.split(/\r?\n/)) {
      const m = /^\$(\d+)=(.*)$/.exec(line.trim())
      if (m) {
        window.recta.send(line.trim())
        await new Promise((r) => setTimeout(r, 20)) // gentle pacing
      }
    }
    setTimeout(read, 300)
  }

  // Auto-square only makes sense on a ganged axis with two limit switches — show
  // that category only when the firmware actually reports its dual-axis setting
  // ($347). On a cloned / single-switch build it stays hidden.
  const hasAutoSquare = valMap[347] !== undefined

  // sidebar groups (Android-style categories → detail pane on the right)
  const GROUPS: { label: string; ids: string[] }[] = [
    {
      label: t('ui.settings.group.machine'),
      ids: ['spindle', 'motors', 'homing', ...(hasAutoSquare ? ['autosquare'] : []), 'limits', 'inputs', 'outputs']
    },
    { label: t('ui.settings.group.connectivity'), ids: ['network', 'pendant'] },
    { label: t('ui.settings.group.other'), ids: ['controls', 'probe', 'stock', 'macros', 'behavior'] },
    { label: t('ui.settings.group.system'), ids: ['advanced', 'firmware', 'board', 'errors', 'diagnostics', 'theme'] }
  ]

  const catLabel = (id: string): string => {
    if (id === 'advanced') return t('ui.settings.cat.advanced')
    if (id === 'firmware') return t('ui.settings.tab.firmware')
    if (id === 'board') return t('ui.settings.tab.board')
    if (id === 'errors') return t('ui.settings.cat.errors')
    if (id === 'diagnostics') return t('ui.settings.cat.diagnostics')
    if (id === 'theme') return t('ui.settings.cat.theme')
    if (id === 'controls') return t('ui.settings.cat.controls')
    if (id === 'probe') return t('ui.probeSet.title')
    if (id === 'stock') return t('ui.stock.title')
    const sec = SECTIONS.find((s) => s.id === id)
    return sec ? t(sec.title) : id
  }
  const catIcon = (id: string): JSX.Element => {
    if (id === 'advanced') return <ListIcon className="h-4 w-4" />
    if (id === 'firmware') return <UploadIcon className="h-4 w-4" />
    if (id === 'board') return <ChipIcon className="h-4 w-4" />
    if (id === 'errors') return <AlertIcon className="h-4 w-4" />
    if (id === 'diagnostics') return <PulseIcon className="h-4 w-4" />
    if (id === 'theme') return <ThemeIcon className="h-4 w-4" />
    if (id === 'controls') return <ControlsIcon className="h-4 w-4" />
    if (id === 'probe') return <ProbeIcon className="h-4 w-4" />
    if (id === 'stock') return <StockIcon className="h-4 w-4" />
    return <SectionIcon id={id} className="h-4 w-4" />
  }

  // is the current category a $-settings view (vs firmware/board/errors/theme/controls)?
  const isSettings =
    cat !== 'firmware' &&
    cat !== 'board' &&
    cat !== 'errors' &&
    cat !== 'diagnostics' &&
    cat !== 'theme' &&
    cat !== 'controls' &&
    cat !== 'probe' &&
    cat !== 'stock'
  const searchable = isSettings || cat === 'errors'

  const pane =
    cat === 'firmware' ? (
      <>
        <FirmwareFlash headerSlot={headerSlot} />
        <AppUpdate />
      </>
    ) : cat === 'board' ? (
      <BoardDiagram />
    ) : cat === 'errors' ? (
      <ErrorsReference filter={query} />
    ) : cat === 'diagnostics' ? (
      <Diagnostics />
    ) : cat === 'theme' ? (
      <ThemeSettings />
    ) : cat === 'controls' ? (
      <ControlsSettings />
    ) : cat === 'probe' ? (
      <>
        <ProbeSettings />
        {/* firmware probe settings ($6 invert, $65 options, …) grouped here too */}
        <SettingsGuided vals={valMap} axes={axes} write={write} selected="probe" />
      </>
    ) : cat === 'stock' ? (
      <StockSettings />
    ) : rows.length === 0 ? (
      <div className="p-8 text-center font-mono text-sm text-slate-500">
        {!connected
          ? t('ui.settings.empty.disconnected')
          : busy
            ? t('ui.settings.empty.busy')
            : t('ui.settings.empty.connected')}
      </div>
    ) : (
      <SettingsGuided vals={valMap} axes={axes} write={write} filter={query} selected={cat} />
    )

  return (
    // fills ONLY the right pane (same rounded rectangle as the visualizer), so the
    // TopBar, the left column and the footer stay put — nothing resizes on switch
    <div className="absolute inset-0 z-30 flex flex-col overflow-hidden rounded-lg border border-border bg-panel">
      {/* header, split on the same grid as the body: title above the stub,
          search + actions above the detail pane (so search aligns with it) */}
      <div className="flex items-stretch border-b border-border">
        <div className="flex w-[17.55rem] shrink-0 items-center gap-1.5 border-r border-border px-3 py-2 font-display text-sm font-bold tracking-wider text-brand">
          <GearIcon /> {t('ui.settings.tab.settings')}
        </div>
        {/* mirrors a setting ROW exactly: same px-3 and gap-6, search occupying the
            label column and the actions the w-[32rem] control column — so the search
            box ends precisely where every setting's value begins */}
        <div className="flex min-w-0 flex-1 items-center gap-6 px-3 py-2">
          {/* On a tab with nothing to search the field would just sit there dead, so
              the space becomes a slot the pane can fill instead — Firmware puts its
              bootloader / detect / flash row here (rendered via a portal, so all of
              that state stays inside FirmwareFlash). */}
          {!searchable ? (
            <div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center" />
          ) : (
          <div className="relative min-w-0 flex-1">
            <input
              className="input !py-1.5 w-full pr-8 text-sm"
              placeholder={searchable ? t('ui.settings.search') : ''}
              value={query}
              disabled={!searchable}
              onChange={(e) => setQuery(e.target.value)}
            />
            {/* one slot on the right of the field: a magnifier while it is empty,
                a clear button once there is something to clear */}
            {/* both sit in the SAME box, so the clear button lands exactly where the
                magnifier was instead of jumping to the field's edge */}
            {query ? (
              <button
                className="absolute right-2.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-xs text-slate-500 transition hover:text-brand"
                onClick={() => setQuery('')}
                title={t('ui.settings.search')}
              >
                ✕
              </button>
            ) : (
              <SearchIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            )}
          </div>
          )}
          {/* every control here carries the search field's `py-1.5`, so the whole row
              sits on one height. The three actions take only the width their labels
              need; the slack goes to the language picker, which holds a real word. */}
          <div className="flex w-[32rem] shrink-0 items-center gap-2">
            {isSettings && (
              <>
                {/* all three a fixed 95px: equal blocks, and the Read button no
                    longer twitches when its label swaps to "Reading…" */}
                <button
                  className="btn w-[95px] shrink-0 px-0 py-1.5 text-sm"
                  disabled={!connected || reading || busy}
                  title={busy ? t('ui.settings.empty.busy') : undefined}
                  onClick={read}
                >
                  {reading ? t('ui.settings.reading') : t('ui.settings.read')}
                </button>
                <button
                  className="btn w-[95px] shrink-0 px-0 py-1.5 text-sm"
                  disabled={rows.length === 0}
                  onClick={exportSettings}
                >
                  {t('ui.settings.export')}
                </button>
                <button
                  className="btn w-[95px] shrink-0 px-0 py-1.5 text-sm"
                  disabled={!connected}
                  onClick={() => fileRef.current?.click()}
                >
                  {t('ui.settings.import')}
                </button>
                <input ref={fileRef} type="file" accept=".txt,.nc" className="hidden" onChange={importSettings} />
              </>
            )}
            <LanguageSelect className="min-w-0 flex-1" />
            <button
              className="btn h-[34px] w-9 shrink-0 px-0 py-0 text-sm leading-none"
              onClick={() => setOpen(false)}
              title={t('ui.tabs.collapse')}
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* master-detail: category stub (left) + detail (right) */}
      <div className="flex min-h-0 flex-1">
        <nav className="w-[17.55rem] shrink-0 overflow-y-auto border-r border-border p-2">
          {GROUPS.map((g) => (
            <div key={g.label} className="mb-2">
              <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                {g.label}
              </div>
              {g.ids.map((id) => (
                <button
                  key={id}
                  onClick={() => setCat(id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                    cat === id ? 'bg-brand/15 font-semibold text-brand' : 'text-slate-300 hover:bg-panel2'
                  }`}
                >
                  {catIcon(id)}
                  <span className="truncate">{catLabel(id)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* the board pinout is a reference screen: it fits itself to the pane,
              so it must NOT get a scrollbar (every other pane still scrolls) */}
          <div className={`min-h-0 flex-1 ${cat === 'board' ? 'overflow-hidden' : 'overflow-y-auto'}`}>{pane}</div>
          {isSettings && (
            <div className="flex items-center gap-2 border-t border-border px-4 py-2 font-mono text-[10px] text-slate-500">
              <span>{t('ui.settings.footer')}</span>
              {rows.length > 0 && (
                <span className="ml-auto text-slate-400">{t('ui.settings.count', { n: rows.length })}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
