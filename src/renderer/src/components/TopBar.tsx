import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { SerialPortInfo } from '@shared/types'
import { useT, useLabel } from '../i18n'
import appIcon from '../assets/icon.png'
import { stateColor as colorForState } from '../machineState'
import { GearIcon } from './icons'

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
  const info = useStore((s) => s.info)
  /** Is the board sitting on the USB bus, whether or not we are talking over it?
   *  It enumerates or it does not, so this is a fact rather than a guess. Polled
   *  because a cable can come and go while the app is open. */
  const [usbPresent, setUsbPresent] = useState(false)
  useEffect(() => {
    let stop = false
    const look = async (): Promise<void> => {
      try {
        const list = await window.recta.listPorts()
        if (!stop) setUsbPresent(list.some((p) => p.usb))
      } catch {
        /* nothing to say about a port list we could not read */
      }
    }
    look()
    const timer = setInterval(look, 4000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [])
  // The board's own answer to "what do you carry" ($I's NEWOPT), so a board built
  // without the W5500 shows no ethernet mark at all instead of a permanently grey one.
  const hasEth = connKind === 'ethernet' || !!info.newopt?.includes('ETH')
  const hasUsb = connKind === 'usb' || usbPresent

  const refreshPorts = async (): Promise<void> => {
    const list = await window.recta.listPorts()
    setPorts(list)
    // Offer a USB port, never merely the first one. On a PC with a chipset COM1 the
    // first one is COM1 — an empty UART that opens without complaint — and it sat
    // pre-filled in this box waiting to be connected to. Every port stays in the list
    // below; this only decides what the operator is handed without asking.
    const first = list.find((p) => p.usb)
    if (first && !port) setPort(first.path)
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
        {/* No frame, and a gear big enough to be read as one. The bordered `btn` made
            it look like a third connection control sitting next to Connect, which is
            the one thing it is not; a bare gear is what an operator reaches for. */}
        <button
          className="rounded-md p-1.5 text-slate-300 transition hover:bg-panel2 hover:text-white"
          onClick={() => setSettingsOpen(true)}
          title={t('ui.top.settingsTitle')}
        >
          <GearIcon className="h-7 w-7" />
        </button>

        {connected ? (
          <>
            {/* Both paths, when both are there: the one carrying the session in its own
                colour, the other grey. Which cable is live is the thing an operator most
                wants to read off this bar, and showing only the winner never said whether
                the other was even plugged in.
                USB presence is real — the board enumerates, so the port is either there
                or it is not. ETHERNET IS NOT DETECTABLE: grblHAL reports no link state,
                so the grey ETH mark means "this build has ethernet", not "the cable is
                in". Said plainly rather than guessed at. */}
            {hasEth && (
              <span
                className={`flex items-center gap-1.5 text-xs font-semibold ${connKind === 'ethernet' ? 'text-ok' : 'text-slate-500'}`}
                title={connKind === 'ethernet' ? t('ui.top.ethTitle') : t('ui.top.ethIdle')}
              >
                <EthIcon />
                ETH
              </span>
            )}
            {hasUsb && (
              <span
                className={`flex items-center gap-1.5 text-xs font-semibold ${connKind === 'usb' ? 'text-warn' : 'text-slate-500'}`}
                title={connKind === 'usb' ? t('ui.top.usbTitle') : t('ui.top.usbIdle')}
              >
                <UsbcIcon />
                USB-C
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
            className="rounded-md bg-brand px-4 py-1.5 font-semibold text-[#020617] transition hover:bg-brandDark"
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
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-brand/50 bg-brand/10 py-2 text-sm font-semibold text-brand transition hover:bg-brand hover:text-[#020617] disabled:opacity-50"
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
                  mode === m ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-300 hover:bg-border'
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
            className="mt-3 w-full rounded-md bg-brand py-2 font-semibold text-[#020617] transition hover:bg-brandDark disabled:opacity-50"
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
  // RJ45 plug seen head-on: the body, the latch tab on top, and four contacts.
  // The old one was a wall socket with legs, which read as neither.
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 3h5v2.5H17a1.5 1.5 0 0 1 1.5 1.5v12.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7a1.5 1.5 0 0 1 1.5-1.5h2.5V3Z" />
      <path d="M8.5 9v3.5M10.8 9v3.5M13.2 9v3.5M15.5 9v3.5" />
    </svg>
  )
}

/** USB-C connector: the oval shell with its tongue. */
function UsbcIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="8" width="19" height="8" rx="4" />
      <rect x="6" y="10.9" width="12" height="2.2" rx="1.1" />
    </svg>
  )
}

