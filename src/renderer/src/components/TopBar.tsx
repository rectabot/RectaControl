import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { SerialPortInfo } from '@shared/types'
import { useT, useLabel } from '../i18n'
import appIcon from '../assets/icon.png'
import { stateColor as colorForState } from '../machineState'
import { GearIcon, EthIcon, UsbcIcon } from './icons'

/** One width for both states of the connection control. Connected and disconnected
 *  are the same size to the pixel, so the bar does not reflow when the link comes up
 *  or drops — and the manual panel is cut to this too. In rem, so it rides the app's
 *  UI scale like everything else. */
const CONN_W = 'w-[10.4rem]'
const CONN_H = 'h-[35px]'

export function TopBar(): JSX.Element {
  const t = useT()
  const L = useLabel()
  const connected = useStore((s) => s.connected)
  const connKind = useStore((s) => s.connKind)
  const connOpts = useStore((s) => s.connOpts)
  const status = useStore((s) => s.status)
  const units = useStore((s) => s.units)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const pushConsole = useStore((s) => s.pushConsole)
  const jobRunning = useStore((s) => s.job.running)
  const askConfirm = useStore((s) => s.askConfirm)
  const autoConnect = useStore((s) => s.autoConnect)
  const setAutoConnect = useStore((s) => s.setAutoConnect)

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'usb' | 'ethernet'>('usb')
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [usbPresent, setUsbPresent] = useState(false)
  const [port, setPort] = useState('')
  const [baud, setBaud] = useState(() => localStorage.getItem('conn.baud') || '115200')
  const [host, setHost] = useState(() => localStorage.getItem('conn.ethHost') || '192.168.5.1')
  const [tcpPort, setTcpPort] = useState(() => localStorage.getItem('conn.ethPort') || '23')
  const [busy, setBusy] = useState(false)

  // The panel is cut to the control that opens it rather than to a width of its own,
  // so the two read as one object. Measured instead of hard-coded because the control
  // is as wide as its labels, and those change with the UI scale.
  const connRef = useRef<HTMLDivElement>(null)
  const [menuWidth, setMenuWidth] = useState<number>()
  useLayoutEffect(() => {
    const el = connRef.current
    if (!open || !el) return
    const measure = (): void => setMenuWidth(el.offsetWidth)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  const refreshPorts = async (): Promise<void> => {
    const list = await window.recta.listPorts()
    setPorts(list)
    // Is there a board on the bus at all? Of the two paths this bar offers, USB is the
    // only one that can be answered with a fact — a device enumerates or it does not —
    // so it is the only one whose button gets to be switched off.
    setUsbPresent(list.some((p) => p.usb))
    // Offer a USB port, never merely the first one. On a PC with a chipset COM1 the
    // first one is COM1 — an empty UART that opens without complaint — and it sat
    // pre-filled in this box waiting to be connected to. Every port stays in the list
    // below; this only decides what the operator is handed without asking.
    // Set through the updater so the poll below can never overwrite a typed value.
    const first = list.find((p) => p.usb)
    if (first) setPort((cur) => cur || first.path)
  }

  // Polled while disconnected: a cable is pulled and pushed back in while the app is
  // open, and the USB button's state is only worth anything if it keeps up. Stops the
  // moment a session exists — by then the question is answered.
  useEffect(() => {
    if (connected) return
    let alive = true
    const tick = (): void => {
      if (alive) refreshPorts()
    }
    tick()
    const id = setInterval(tick, 3000)
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

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

  /** One click, one path. The bar's two halves connect straight away instead of
   *  opening a form to fill in: the port comes from pickBoardPort (the same choice
   *  auto-connect makes) and the address from what was used last. The form is still
   *  there behind the chevron for the machine that is not on the usual address. */
  const connectDirect = async (kind: 'usb' | 'ethernet'): Promise<void> => {
    setBusy(true)
    persist()
    try {
      if (kind === 'usb') {
        const path = await window.recta.pickBoardPort()
        if (!path) {
          // Reachable if the board leaves the bus between the poll and the click.
          pushConsole(`! ${t('ui.top.usbNone')}`)
          return
        }
        await window.recta.connect({ kind: 'usb', port: path, baud: Number(baud) })
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

  // What the live link actually is, straight from main. Not the fields in this
  // component: those hold what someone last typed, and the port auto-connect chose
  // was never typed anywhere. A readout that names the wrong port is the COM1 bug
  // wearing a different hat.
  const connTarget =
    connOpts?.kind === 'usb' ? connOpts.port : connOpts?.kind === 'ethernet' ? connOpts.host : ''

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
          /* One button, the same width as the control it replaces, so nothing in the
             bar moves when the link comes up. It reads as a readout — which cable,
             which port, at what rate — and only turns into Disconnect under the
             pointer, where the intention to click it already is. The two states are
             stacked in a grid cell rather than swapped, so the button cannot resize
             on hover either. */
          /* Amber for USB, green for Ethernet — the colour is the answer to "which
             cable is this running on", readable across the shop without reading the
             word. Amber is not a warning here: USB is the cable you are more likely
             to have left in from a flash, and the one worth noticing. */
          <button
            className={`group grid ${CONN_W} ${CONN_H} place-items-center overflow-hidden rounded-md border transition hover:border-danger hover:bg-danger hover:text-white ${
              connKind === 'ethernet' ? 'border-ok/40 bg-ok/10 text-ok' : 'border-warn/40 bg-warn/10 text-warn'
            }`}
            onClick={onDisconnectClick}
            title={connKind === 'ethernet' ? t('ui.top.ethTitle') : t('ui.top.usbTitle')}
          >
            {/* Reads left to right the way it is spoken: the mark, which path, where. */}
            <span className="col-start-1 row-start-1 flex items-center gap-1.5 leading-none group-hover:invisible">
              {connKind === 'ethernet' ? <EthIcon className="h-4 w-4 flex-none" /> : <UsbcIcon className="h-4 w-4 flex-none" />}
              <span className="text-xs font-bold">{connKind === 'ethernet' ? 'ETH' : 'USB'}</span>
              <span className="font-mono text-xs font-bold">{connTarget}</span>
            </span>
            <span className="invisible col-start-1 row-start-1 text-sm font-semibold group-hover:visible">
              {L('ui.top.disconnect')}
            </span>
          </button>
        ) : (
          /* The two paths are the button. Picking one used to mean opening a panel,
             choosing a tab, and pressing Connect — three clicks to say a thing the
             operator already knew when they reached for the mouse. */
          <div
            ref={connRef}
            className={`group grid ${CONN_W} ${CONN_H} overflow-hidden rounded-md border border-brand/40 bg-brand/10`}
          >
            {/* At rest it is one button saying what it is for. The three ways in only
                appear under the pointer — the same trade the connected side makes, and
                for the same reason: the bar is a status strip most of the time, and
                three cyan segments sitting there permanently read as three things to
                do rather than one. Held open while the manual panel is, or the panel
                would be hanging off a button that had folded back up. */}
            <span
              className={`pointer-events-none col-start-1 row-start-1 grid place-items-center text-xs font-semibold text-brand ${
                open ? 'invisible' : 'group-hover:invisible'
              }`}
            >
              {busy ? L('ui.top.connecting') : L('ui.top.connectMachine')}
            </span>

            <div
              className={`col-start-1 row-start-1 flex items-stretch ${
                open ? 'visible' : 'invisible group-hover:visible'
              }`}
            >
            <button
              className="flex flex-1 items-center justify-center gap-1.5 bg-brand/10 text-xs font-semibold text-brand transition enabled:hover:bg-brand enabled:hover:text-[#020617] disabled:cursor-not-allowed disabled:bg-slate-500/5 disabled:text-slate-600"
              onClick={() => connectDirect('usb')}
              disabled={busy || !usbPresent}
              title={usbPresent ? t('ui.top.usbBtnTitle') : t('ui.top.usbNone')}
            >
              <UsbcIcon className="h-4 w-4 flex-none" />
              USB
            </button>
            <button
              className="flex flex-1 items-center justify-center gap-1.5 border-l border-brand/40 bg-brand/10 text-xs font-semibold text-brand transition enabled:hover:bg-brand enabled:hover:text-[#020617] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => connectDirect('ethernet')}
              disabled={busy}
              title={t('ui.top.ethBtnTitle', { host, port: tcpPort })}
            >
              <EthIcon className="h-4 w-4 flex-none" />
              ETH
            </button>
            <button
              className="w-6 flex-none border-l border-brand/40 bg-brand/10 text-xs text-brand transition hover:bg-brand hover:text-[#020617]"
              onClick={() => setOpen((o) => !o)}
              title={t('ui.top.manualTitle')}
            >
                ▾
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Manual connection — the address the two buttons above do not cover. Cut to
          their width and squared off under them: it is the same control continued
          downwards, not a dialog that happens to appear nearby. Everything inside is
          sized to that width rather than the width being sized to fit a form. */}
      {open && !connected && (
        <div
          className="absolute right-4 top-full z-40 mt-1 flex flex-col gap-1 rounded-md border border-brand/40 bg-panel p-1.5 shadow-glow"
          style={menuWidth ? { width: menuWidth } : undefined}
        >
          {/* Row 1 — the same two halves as the button above, so the eye reads the panel
              as belonging to it. Here they choose which form to fill in, not where to go. */}
          <div className="flex h-7 items-stretch overflow-hidden rounded-md border border-border2">
            {(['usb', 'ethernet'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex flex-1 items-center justify-center gap-1.5 text-xs font-semibold transition ${
                  mode === m ? 'bg-brand text-[#020617]' : 'bg-panel2 text-slate-300 hover:bg-border'
                }`}
              >
                {m === 'usb' ? <UsbcIcon className="h-4 w-4" /> : <EthIcon className="h-4 w-4" />}
                {m === 'usb' ? 'USB' : 'ETH'}
              </button>
            ))}
          </div>

          {/* Rows 2 and 3 — two fields either way, so the panel is the same height in
              both modes and nothing below it moves when the mode is switched. */}
          {mode === 'usb' ? (
            <>
              <div className="flex h-7 gap-1.5">
                <input
                  className="input h-7 min-w-0 flex-1 px-2 py-0 text-xs"
                  list="ports"
                  value={port}
                  placeholder={t('ui.top.portPlaceholder')}
                  onChange={(e) => setPort(e.target.value)}
                />
                <button className="btn h-7 px-2 py-0 text-xs" onClick={refreshPorts} title={t('ui.top.refresh')}>
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
              <select
                className="input h-7 px-2 py-0 text-xs"
                value={baud}
                onChange={(e) => setBaud(e.target.value)}
              >
                {['115200', '250000', '230400', '57600'].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </>
          ) : (
            <>
              <input
                className="input h-7 px-2 py-0 text-xs"
                value={host}
                placeholder={t('ui.top.ipPlaceholder')}
                onChange={(e) => setHost(e.target.value)}
              />
              <input
                className="input h-7 px-2 py-0 text-xs"
                value={tcpPort}
                placeholder={t('ui.top.tcpPlaceholder')}
                onChange={(e) => setTcpPort(e.target.value)}
              />
            </>
          )}

          {/* Row 4 */}
          <button
            className="h-7 w-full rounded-md bg-brand text-xs font-semibold text-[#020617] transition hover:bg-brandDark disabled:opacity-50"
            onClick={connect}
            disabled={busy}
          >
            {busy ? L('ui.top.connecting') : L('ui.top.connect')}
          </button>

          {/* Row 5 — a setting, not an action, so it is a switch and not a button. It
              governs both places the app reaches for the board on its own: the attempt
              at launch and the chase after the board reboots. Off, every connection
              starts with a click on this panel or on the two halves above it. */}
          <button
            className="flex h-7 w-full items-center justify-between rounded-md border border-border2 bg-panel2 px-2 text-xs text-slate-300 transition hover:border-brand"
            onClick={() => setAutoConnect(!autoConnect)}
            title={t(autoConnect ? 'ui.top.autoOnTitle' : 'ui.top.autoOffTitle')}
            role="switch"
            aria-checked={autoConnect}
          >
            <span>{L('ui.top.autoConnect')}</span>
            <span
              className={`relative h-4 w-8 flex-none rounded-full transition-colors ${
                autoConnect ? 'bg-brand' : 'bg-border2'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                  autoConnect ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
