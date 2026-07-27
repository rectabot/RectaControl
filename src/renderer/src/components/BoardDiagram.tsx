import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

type Group = 'input' | 'stepper' | 'power' | 'comm' | 'output' | 'storage' | 'adjust'

interface Connector {
  id: string
  label: string
  group: Group
  x: number // % of image width
  y: number // % of image height
  pins: string
}

const GROUP_COLOR: Record<Group, string> = {
  input: '#fbbf24', // warn — isolated inputs
  stepper: '#22d3ee', // brand — motors
  power: '#ef4444', // danger — power
  comm: '#a855f7', // purple — comms
  output: '#10b981', // ok — outputs
  storage: '#3390EC', // blue — sd
  adjust: '#e2e8f0' // slate — trimmer / calibration
}

const GROUPS = Object.keys(GROUP_COLOR) as Group[]

// Positions are % of the board image (calibrated against board.png). Each
// connector's description is an i18n key derived from its id: `board.<id>.desc`.
const CONNECTORS: Connector[] = [
  // top: isolated 24V inputs (24V / GND / SIG each) — row aligned to y 4.8
  { id: 'door', label: 'DOOR · CN22', group: 'input', x: 10.8, y: 4.8, pins: '24V · GND · SIG' },
  { id: 'hold', label: 'FEED HOLD · CN23', group: 'input', x: 18.7, y: 4.8, pins: '24V · GND · SIG' },
  { id: 'start', label: 'CYC START · CN24', group: 'input', x: 26.9, y: 4.8, pins: '24V · GND · SIG' },
  { id: 'probe', label: 'PROBE · CN25', group: 'input', x: 35.1, y: 4.8, pins: '24V · GND · SIG' },
  { id: 'estop', label: 'ESTOP · CN26', group: 'input', x: 43, y: 4.8, pins: '24V · GND · SIG' },
  { id: 'blim', label: 'B_lim · CN27', group: 'input', x: 51.2, y: 4.8, pins: '24V · GND · SIG' },
  { id: 'alim', label: 'A_lim · CN28', group: 'input', x: 59.3, y: 4.8, pins: '24V · GND · SIG' },
  { id: 'zlim', label: 'Z_lim · CN29', group: 'input', x: 67.1, y: 4.8, pins: '24V · GND · SIG' },
  { id: 'ylim', label: 'Y_lim · CN30', group: 'input', x: 75.4, y: 4.8, pins: '24V · GND · SIG' },
  { id: 'xlim', label: 'X_lim · CN31', group: 'input', x: 83.5, y: 4.8, pins: '24V · GND · SIG' },

  // left: storage + comms
  { id: 'sd', label: 'microSD · CARD1', group: 'storage', x: 5.4, y: 31.5, pins: 'microSD' },
  { id: 'usb', label: 'USB-C · USBC1', group: 'comm', x: 2.7, y: 47.3, pins: 'USB-C' },
  { id: 'eth', label: 'Ethernet · 100BASE-TX', group: 'comm', x: 7.7, y: 68, pins: 'RJ45' },

  // bottom-left: comms terminals — row aligned to y 94.8
  { id: 'rs485', label: 'RS485 MODBUS · CN32', group: 'comm', x: 19.8, y: 94.8, pins: 'GND · A+ · B−' },
  { id: 'pendant', label: 'RS422 PENDANT · CN41', group: 'comm', x: 32.2, y: 94.8, pins: '24V · TX+ · TX− · RX+ · RX− · GND' },

  // bottom: stepper outputs (+5V / STEP / DIR / EN) — row aligned to y 94.8
  { id: 'mx', label: 'X · CN34', group: 'stepper', x: 46.2, y: 94.8, pins: '+5V · STEP · DIR · EN' },
  { id: 'my', label: 'Y · CN35', group: 'stepper', x: 56.6, y: 94.8, pins: '+5V · STEP · DIR · EN' },
  { id: 'mz', label: 'Z · CN36', group: 'stepper', x: 66.9, y: 94.8, pins: '+5V · STEP · DIR · EN' },
  { id: 'ma', label: 'A · CN37', group: 'stepper', x: 77.6, y: 94.8, pins: '+5V · STEP · DIR · EN' },
  { id: 'mb', label: 'B · CN38', group: 'stepper', x: 87.7, y: 94.8, pins: '+5V · STEP · DIR · EN' },

  // right: power + outputs — column aligned to x 96.5
  { id: 'pwr24', label: '24V DC IN · CN42', group: 'power', x: 96.5, y: 40.1, pins: '+24V · GND' },
  { id: 'laser', label: 'LASER · CN33', group: 'output', x: 96.5, y: 49.1, pins: 'PWM · GND' },
  { id: 'vfd', label: 'VFD · CN39', group: 'output', x: 96.5, y: 60.8, pins: '0–10V · EN · DIR · GND' },
  { id: 'aux', label: 'AUX · CN40', group: 'output', x: 96.5, y: 78.8, pins: '+5V · VAC · FLOOD · MIST · GND' },

  // trimmer: 0–10V analog calibration
  { id: 'cal10v', label: 'CALIBRATE 10V', group: 'adjust', x: 79.5, y: 58.9, pins: 'trimer' },

  // isolated power block (DC-DC) — feeds the galvanically isolated input side
  { id: 'isopwr', label: 'ISO POWER', group: 'power', x: 90, y: 15, pins: 'DC-DC · iso rail' }
]

/** Interactive board pinout: click a connector on the RectaBot render to see what
 *  to wire and the pin order. Image lives in src/renderer/public/board.png and is
 *  loaded at runtime (graceful placeholder if missing).
 *
 *  This is a reference screen, so it fills the pane instead of scrolling: the
 *  detail box below keeps a fixed height and the board fits (letterboxed) into
 *  the height that is left. The hotspot layer is sized to the FITTED box —
 *  hotspot %-positions only line up if their parent is exactly the rendered
 *  image, never the empty space around it. */
export function BoardDiagram(): JSX.Element {
  const t = useT()
  const [selected, setSelected] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  // natural aspect of board.png; the 3:2 default only applies until it loads
  const [ratio, setRatio] = useState(3 / 2)
  const [fit, setFit] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const boxRef = useRef<HTMLDivElement>(null)

  const sel = CONNECTORS.find((c) => c.id === selected) ?? null

  // fit the image into the free space, remeasuring on any window/pane resize
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = (): void => {
      const { width, height } = el.getBoundingClientRect()
      if (!width || !height) return
      const w = Math.min(width, height * ratio)
      setFit({ w, h: w / ratio })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ratio])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      {/* board: takes everything the detail box below does not need */}
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        {imgError ? (
          <div className="flex h-full w-full items-center justify-center rounded-lg border border-border bg-panel2 p-8 text-center font-mono text-xs text-slate-500">
            {t('board.imgMissing')}
          </div>
        ) : (
          <div
            className="relative select-none overflow-hidden rounded-lg border border-border bg-panel2"
            style={{ width: fit.w, height: fit.h }}
          >
            <img
              src="./board.png"
              alt="RectaBot v1.0"
              className="block h-full w-full"
              onLoad={(e) => {
                const el = e.currentTarget
                if (el.naturalWidth && el.naturalHeight) setRatio(el.naturalWidth / el.naturalHeight)
              }}
              onError={() => setImgError(true)}
            />

            {CONNECTORS.map((c) => {
              const active = c.id === selected
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(active ? null : c.id)}
                  title={c.label}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition ${
                    active ? 'h-5 w-5 ring-2 ring-white' : 'h-4 w-4 hover:scale-125'
                  }`}
                  style={{
                    left: `${c.x}%`,
                    top: `${c.y}%`,
                    borderColor: GROUP_COLOR[c.group],
                    backgroundColor: active ? GROUP_COLOR[c.group] : `${GROUP_COLOR[c.group]}66`
                  }}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* legend + hint on one slim line between the board and the detail box */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
        {GROUPS.map((g) => (
          <span key={g} className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GROUP_COLOR[g] }} />
            {t(`board.grp.${g}`)}
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px] text-slate-500">{t('board.hint')}</span>
      </div>

      {/* detail box — full width, FIXED height: the board fits into what is left,
          so selecting a connector never resizes the board and nothing scrolls */}
      {sel ? (
        <div
          className="flex h-[9.5rem] shrink-0 gap-4 rounded-lg border border-border bg-panel2 p-4"
          style={{ borderColor: `${GROUP_COLOR[sel.group]}88` }}
        >
          {/* identity: name, group, pin order */}
          <div className="flex w-[20rem] shrink-0 flex-col gap-2 border-r border-border2 pr-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: GROUP_COLOR[sel.group] }} />
              <span className="truncate font-display text-base font-bold text-slate-100">{sel.label}</span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
              {t(`board.grp.${sel.group}`)}
            </span>
            <div className="rounded bg-base px-2.5 py-1 text-center font-mono text-sm text-brand">{sel.pins}</div>
          </div>

          {/* what it does */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm leading-relaxed text-slate-300">{t(`board.${sel.id}.desc`)}</p>
            {sel.group === 'input' && (
              <div className="mt-auto flex gap-2 rounded-md border border-border2 bg-base p-2.5 text-[11px] leading-snug text-slate-400">
                <span className="shrink-0 text-sm">💡</span>
                <span>{t('board.inputHint')}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-[9.5rem] shrink-0 items-center justify-center rounded-lg border border-dashed border-border p-4 text-center font-mono text-xs text-slate-500">
          {t('board.pickPrompt')}
        </div>
      )}
    </div>
  )
}
