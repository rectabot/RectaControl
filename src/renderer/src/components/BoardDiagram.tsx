import { useState } from 'react'
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
 *  loaded at runtime (graceful placeholder if missing). Calibration mode shows
 *  click %-coordinates so hotspot positions can be fine-tuned. */
export function BoardDiagram(): JSX.Element {
  const t = useT()
  const [selected, setSelected] = useState<string | null>(null)
  const [calib, setCalib] = useState(false)
  const [click, setClick] = useState<{ x: number; y: number } | null>(null)
  const [imgError, setImgError] = useState(false)

  const sel = CONNECTORS.find((c) => c.id === selected) ?? null

  const onImgClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!calib) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = Number((((e.clientX - r.left) / r.width) * 100).toFixed(1))
    const y = Number((((e.clientY - r.top) / r.height) * 100).toFixed(1))
    setClick({ x, y })
    navigator.clipboard?.writeText(`x: ${x}, y: ${y}`)
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-slate-400">{t('board.hint')}</span>
        <label className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
          <input type="checkbox" className="accent-brand" checked={calib} onChange={(e) => setCalib(e.target.checked)} />
          {t('board.calib')}
        </label>
        {calib && click && (
          <span className="font-mono text-[10px] text-brand">
            x: {click.x}, y: {click.y} {t('board.copied')}
          </span>
        )}
      </div>

      {/* board image + hotspots */}
      <div className="relative w-full select-none overflow-hidden rounded-lg border border-border bg-panel2" onClick={onImgClick}>
        {imgError ? (
          <div className="flex aspect-[3/2] items-center justify-center p-8 text-center font-mono text-xs text-slate-500">
            {t('board.imgMissing')}
          </div>
        ) : (
          <img src="./board.png" alt="RectaBot v1.0" className="block w-full" onError={() => setImgError(true)} />
        )}

        {!imgError &&
          CONNECTORS.map((c) => {
            const active = c.id === selected
            return (
              <button
                key={c.id}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(active ? null : c.id)
                }}
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

      {/* legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {GROUPS.map((g) => (
          <span key={g} className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GROUP_COLOR[g] }} />
            {t(`board.grp.${g}`)}
          </span>
        ))}
      </div>

      {/* detail */}
      {sel ? (
        <div className="rounded-lg border border-border bg-panel2 p-4" style={{ borderColor: `${GROUP_COLOR[sel.group]}88` }}>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: GROUP_COLOR[sel.group] }} />
            <span className="font-display text-base font-bold text-slate-100">{sel.label}</span>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-slate-500">
              {t(`board.grp.${sel.group}`)}
            </span>
          </div>
          <div className="mt-2 inline-block rounded bg-base px-2.5 py-1 font-mono text-sm text-brand">{sel.pins}</div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{t(`board.${sel.id}.desc`)}</p>
          {sel.group === 'input' && (
            <div className="mt-3 flex gap-2 rounded-md border border-border2 bg-base p-2.5 text-[11px] leading-snug text-slate-400">
              <span className="shrink-0 text-sm">💡</span>
              <span>{t('board.inputHint')}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-center font-mono text-xs text-slate-500">
          {t('board.pickPrompt')}
        </div>
      )}
    </div>
  )
}
