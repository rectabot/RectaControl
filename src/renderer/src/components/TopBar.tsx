import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { SerialPortInfo } from '@shared/types'
import { useT, useLabel } from '../i18n'
import appIcon from '../assets/icon.png'
import { stateColor as colorForState } from '../machineState'

export function TopBar(): JSX.Element {
  const t = useT()
  const L = useLabel()
  const connected = useStore((s) => s.connected)
  const connKind = useStore((s) => s.connKind)
  const status = useStore((s) => s.status)
  const units = useStore((s) => s.units)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const pushConsole = useStore((s) => s.pushConsole)
  const jobRunning = useStore((s) => s.job.running)
  const askConfirm = useStore((s) => s.askConfirm)

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'usb' | 'ethernet'>('usb')
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [port, setPort] = useState('')
  const [baud, setBaud] = useState(() => localStorage.getItem('conn.baud') || '115200')
  const [host, setHost] = useState(() => localStorage.getItem('conn.ethHost') || '192.168.5.1')
  const [tcpPort, setTcpPort] = useState(() => localStorage.getItem('conn.ethPort') || '23')
  const [busy, setBusy] = useState(false)

  const refreshPorts = async (): Promise<void> => {
    const list = await window.recta.listPorts()
    setPorts(list)
    if (list.length && !port) setPort(list[0].path)
  }
  useEffect(() => {
    refreshPorts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Remember the chosen settings so startup auto-connect reuses them. */
  const persist = (): void => {
    localStorage.setItem('conn.ethHost', host)
    localStorage.setItem('conn.ethPort', tcpPort)
    localStorage.setItem('conn.baud', baud)
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    persist()
    try {
      if (mode === 'usb') {
        if (!port) {
          pushConsole(`! ${t('ui.top.pickPort')}`)
          return
        }
        await window.recta.connect({ kind: 'usb', port, baud: Number(baud) })
      } else {
        await window.recta.connect({ kind: 'ethernet', host, port: Number(tcpPort) })
      }
      setOpen(false)
    } catch (e) {
      pushConsole(`! ${t('ui.top.connErr', { msg: (e as Error).message })}`)
    } finally {
      setBusy(false)
    }
  }

  const autoConnect = async (): Promise<void> => {
    setBusy(true)
    persist()
    try {
      pushConsole(`* ${t('ui.top.autoTry')}`)
      const kind = await window.recta.autoConnect({
        ethHost: host,
        ethPort: Number(tcpPort),
        baud: Number(baud)
      })
      if (kind) setOpen(false)
      else pushConsole(`! ${t('ui.top.autoFail')}`)
    } catch (e) {
      pushConsole(`! ${t('ui.top.autoErr', { msg: (e as Error).message })}`)
    } finally {
      setBusy(false)
    }
  }

  const raw = status?.state ?? '—'
  const base = raw.split(':')[0]
  // Disconnecting mid-cut leaves the spindle running and the controller finishing
  // whatever is already buffered — a costly accident if the button is clicked by
  // mistake. Guard it with a confirm ONLY when it actually matters (a job is
  // streaming, or the machine is moving/held); Idle stays a single click.
  const disconnectRisky =
    jobRunning || base === 'Run' || base === 'Jog' || base === 'Hold' || base === 'Home'
  const onDisconnectClick = async (): Promise<void> => {
    if (disconnectRisky) {
      const ok = await askConfirm({
        title: t('ui.disc.title'),
        body: t('ui.disc.body'),
        confirmLabel: t('ui.disc.confirm'),
        cancelLabel: t('ui.disc.cancel')
      })
      if (!ok) return
    }
    // Meant to be gone: hold off the automatic reconnect, or the app would walk
    // straight back onto the board the operator just stepped away from.
    useStore.getState().setNoReconnect(true)
    window.recta.disconnect()
  }
  // The state readout is a label, so it stays English in every language, exactly
  // like grblHAL's own Idle / Run / Home. "Offline" rather than "Disconnected":
  // shorter (this centred text is the widest thing in the bar) and it does not
  // echo the Connect button sitting next to it.
  const state = connected ? raw : L('ui.top.offline')
  const stateColor = connected ? colorForState(raw) : 'text-slate-500'

  return (
    <div className="relative flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-2">
      {/* left: brand + workspace + status */}
      <div className="flex items-center gap-2">
        <img src={appIcon} alt="RectaControl" className="h-8 w-8 rounded-lg" draggable={false} />
        <span className="font-display text-lg font-black tracking-wider text-brand">rectacontrol</span>
      </div>

      <div className="ml-3 flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-ok shadow-glow' : 'bg-slate-600'}`}
          title={connected ? t('ui.top.connected') : t('ui.top.notConnected')}
        />
        <span
          className="rounded-md border border-border2 px-2 py-0.5 font-mono text-[11px] text-slate-400"
          title={t('ui.top.unitTitle')}
        >
          {L('ui.top.unit')} <span className="font-bold text-slate-200">{units === 'inch' ? 'Inch' : 'mm'}</span>
        </span>
      </div>

      {/* center: machine state */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2">
        {/* the machine state is the one thing worth reading from across the shop —
            sized to be legible at a glance, not to fit the bar's other content */}
        <span className={`font-display text-3xl font-bold tracking-wide ${stateColor}`}>{state}</span>
      </div>

      {/* right: settings + connect (theme moved to Settings → System → Theme) */}
      <div className="ml-auto flex items-center gap-2">
        <button className="btn" onClick={() => setSettingsOpen(true)} title={t('ui.top.settingsTitle')}>
          ⚙
        </button>

        {connected ? (
          <>
            {connKind && (
              <span
                className="flex items-center gap-1.5 rounded-md border border-ok/40 bg-ok/10 px-2.5 py-1.5 text-xs font-semibold text-ok"
                title={connKind === 'ethernet' ? t('ui.top.ethTitle') : t('ui.top.usbTitle')}
              >
                {connKind === 'ethernet' ? <EthIcon /> : <UsbcIcon />}
                {connKind === 'ethernet' ? 'ETH' : 'USB-C'}
              </span>
            )}
            <button
              className="rounded-md bg-danger px-4 py-1.5 font-semibold text-white transition hover:opacity-90"
              onClick={onDisconnectClick}
            >
              {L('ui.top.disconnect')}
            </button>
          </>
        ) : (
          <button
            className="rounded-md bg-brand px-4 py-1.5 font-semibold text-base transition hover:bg-brandDark"
            onClick={() => setOpen((o) => !o)}
          >
            {L('ui.top.connect')} ▾
          </button>
        )}
      </div>

      {/* connection popover */}
      {open && !connected && (
        <div className="absolute right-4 top-full z-40 mt-2 w-72 rounded-lg border border-border bg-panel p-3 shadow-glow">
          <button
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-brand/50 bg-brand/10 py-2 text-sm font-semibold text-brand transition hover:bg-brand hover:text-base disabled:opacity-50"
            onClick={autoConnect}
            disabled={busy}
            title={t('ui.top.autoConnectTitle')}
          >
            ⚡ {L('ui.top.autoConnect')}
          </button>

          <div className="mb-2 flex overflow-hidden rounded-md border border-border2">
            {(['usb', 'ethernet'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 px-3 py-1.5 text-sm transition ${
                  mode === m ? 'bg-brand text-base' : 'bg-panel2 text-slate-300 hover:bg-border'
                }`}
              >
                {m === 'usb' ? 'USB' : 'Ethernet'}
              </button>
            ))}
          </div>

          {mode === 'usb' ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  list="ports"
                  value={port}
                  placeholder={t('ui.top.portPlaceholder')}
                  onChange={(e) => setPort(e.target.value)}
                />
                <button className="btn" onClick={refreshPorts} title={t('ui.top.refresh')}>
                  ↻
                </button>
              </div>
              <datalist id="ports">
                {ports.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.manufacturer ?? ''}
                  </option>
                ))}
              </datalist>
              <select className="input" value={baud} onChange={(e) => setBaud(e.target.value)}>
                {['115200', '250000', '230400', '57600'].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <input
                className="input"
                value={host}
                placeholder={t('ui.top.ipPlaceholder')}
                onChange={(e) => setHost(e.target.value)}
              />
              <input
                className="input"
                value={tcpPort}
                placeholder={t('ui.top.tcpPlaceholder')}
                onChange={(e) => setTcpPort(e.target.value)}
              />
            </div>
          )}

          <button
            className="mt-3 w-full rounded-md bg-brand py-2 font-semibold text-base transition hover:bg-brandDark disabled:opacity-50"
            onClick={connect}
            disabled={busy}
          >
            {busy ? L('ui.top.connecting') : L('ui.top.connect')}
          </button>
        </div>
      )}
    </div>
  )
}

/** RJ45 / Ethernet port glyph. */
function EthIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8" width="18" height="11" rx="1.5" />
      <path d="M7 8V5h10v3" />
      <path d="M7 19v-3M10 19v-3M14 19v-3M17 19v-3" />
    </svg>
  )
}

/** USB-C connector glyph. */
function UsbcIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8.5" width="18" height="7" rx="3.5" />
      <path d="M7.5 12h9" />
    </svg>
  )
}
