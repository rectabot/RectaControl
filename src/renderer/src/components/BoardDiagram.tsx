import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
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

/** Which connectors carry an input the controller reports, and under which letter
 *  of the status report's `Pn:` field.
 *
 *  The letters are not ours to choose — they come straight from grblHAL's
 *  `control_signals_tostring()` map ("RHSDLTEOFM Q  P ") and, for the limits, from
 *  the axis letters. Worth knowing while reading this:
 *
 *  - A limit input reports as its AXIS letter, and min/max are merged into one
 *    letter, so a shared MAX switch shows up on the axis it belongs to.
 *  - E-stop is 'E' on a build that has a dedicated e-stop input and 'R' (reset)
 *    on one that does not — both are listed, so the press registers either way.
 *  - Which functions exist at all is the firmware's business; `$pins` prints the
 *    real mapping if a press ever lights up somewhere unexpected. */
const PIN_SIGNALS: Record<string, string[]> = {
  xlim: ['X'],
  ylim: ['Y'],
  zlim: ['Z'],
  alim: ['A'],
  blim: ['B'],
  probe: ['P'],
  door: ['D'],
  hold: ['H'],
  start: ['S'],
  estop: ['E', 'R']
}

/** Interactive board pinout: click a connector on the RectaBot render to see what
 *  to wire and the pin order. Image lives in src/renderer/public/board.png and is
 *  loaded at runtime (graceful placeholder if missing).
 *
 *  With the live input test on, the same picture becomes the wiring check that is
 *  otherwise a multimeter and a guess: press a switch, and the connector it is
 *  actually wired to lights up. Which is the whole point — the app knows this
 *  board, so it can say "that signal arrived on CN31, the X limit", something no
 *  generic sender can do.
 *
 *  This is a reference screen, so it fills the pane instead of scrolling: the
 *  detail box below keeps a fixed height and the board fits (letterboxed) into
 *  the height that is left. The hotspot layer is sized to the FITTED box —
 *  hotspot %-positions only line up if their parent is exactly the rendered
 *  image, never the empty space around it. */
export function BoardDiagram(): JSX.Element {
  const t = useT()
  const live = useStore((s) => s.pinTest)
  const startTest = useStore((s) => s.startPinTest)
  const stopTest = useStore((s) => s.stopPinTest)
  const connected = useStore((s) => s.connected)
  // the `Pn:` field of the status report — the controller's own view of which
  // inputs are asserted right now, sampled 5×/s idle (20×/s while moving)
  const pins = useStore((s) => s.status?.pins ?? null)
  // set once the board has confirmed $21 is off (the suspend is read/written
  // against the board, never assumed — see suspendLimits in the store)
  const limitsOff = useStore((s) => s.limitsSuspended != null)
  // a program in progress rules the test out entirely: the $21 write it depends on
  // is refused outside Idle, so the test would run with the limits still armed —
  // and suspending them mid-cut is not something to offer in the first place
  const busy = useStore((s) => s.job.running || s.sdRunning)
  const [selected, setSelected] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  /** Inputs seen at least once since the test started. A switch is pressed for a
   *  moment and released; without this the operator would have to watch the screen
   *  and the switch at the same time. */
  const [seen, setSeen] = useState<Record<string, boolean>>({})
  // natural aspect of board.png; the 3:2 default only applies until it loads
  const [ratio, setRatio] = useState(3 / 2)
  const [fit, setFit] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const boxRef = useRef<HTMLDivElement>(null)

  const sel = CONNECTORS.find((c) => c.id === selected) ?? null

  const activeIds = useMemo(() => {
    const set: Record<string, boolean> = {}
    if (pins)
      for (const [id, letters] of Object.entries(PIN_SIGNALS))
        if (letters.some((l) => pins.includes(l))) set[id] = true
    return set
  }, [pins])

  // remember what has fired, so a switch that is pressed and released still counts
  useEffect(() => {
    const hit = Object.keys(activeIds)
    if (!live || !hit.length) return
    setSeen((s) => (hit.every((id) => s[id]) ? s : { ...s, ...Object.fromEntries(hit.map((id) => [id, true])) }))
  }, [activeIds, live])

  // Leaving this screen ends the test, and ending it is what puts hard limits back
  // — so this is not tidiness, it is the guarantee that the machine cannot be left
  // unguarded by clicking away. Reads the flag through the store to avoid ending a
  // test that was never started.
  useEffect(
    () => () => {
      if (useStore.getState().pinTest) void useStore.getState().stopPinTest()
    },
    []
  )

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
              const picked = c.id === selected
              const testable = !!PIN_SIGNALS[c.id]
              const firing = live && !!activeIds[c.id]
              // in test mode the testable connectors carry the story: a live one is
              // white and ringed, one already proven keeps its colour, and everything
              // that cannot report is dimmed out of the way
              const color = firing ? '#ffffff' : GROUP_COLOR[c.group]
              const dim = live && !testable
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(picked ? null : c.id)}
                  title={c.label}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition ${
                    firing ? 'h-6 w-6 animate-pulse ring-4 ring-white/60' : picked ? 'h-5 w-5 ring-2 ring-white' : 'h-4 w-4 hover:scale-125'
                  } ${dim ? 'opacity-25' : ''} ${live && testable && seen[c.id] && !firing ? 'ring-2 ring-ok' : ''}`}
                  style={{
                    left: `${c.x}%`,
                    top: `${c.y}%`,
                    borderColor: color,
                    backgroundColor: firing || picked ? color : `${color}66`
                  }}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Legend + hint + test button on ONE slim line. Deliberately no wrapping: a
          second row would push the board up and resize everything on the screen the
          moment the button's label changed. The hint takes what is left and is
          truncated instead. */}
      <div className="flex shrink-0 items-center gap-x-3 overflow-hidden">
        {GROUPS.map((g) => (
          <span key={g} className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-slate-500">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GROUP_COLOR[g] }} />
            {t(`board.grp.${g}`)}
          </span>
        ))}
        {/* The hint takes the slack and the button is anchored last with a fixed
            width, so the label swapping on click cannot make the button move under
            the cursor — the text beside it simply goes away and comes back. */}
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-slate-500">
          {live ? '' : t('board.hint')}
        </span>
        <button
          className={`btn w-[5.5rem] shrink-0 px-1.5 py-0.5 text-center text-[10px] ${live ? 'border-ok text-ok' : ''}`}
          disabled={!connected || (busy && !live)}
          onClick={() => {
            setSeen({})
            if (live) void stopTest()
            else startTest()
          }}
          title={!connected ? t('board.test.disconnected') : busy && !live ? t('board.test.busy') : t('board.test.title')}
        >
          {live ? `● ${t('board.test.stop')}` : t('board.test.start')}
        </button>
      </div>

      {/* detail box — full width, FIXED height: the board fits into what is left,
          so selecting a connector never resizes the board and nothing scrolls */}
      {live ? (
        <div className="flex h-[9.5rem] shrink-0 flex-col gap-2 rounded-lg border border-ok/50 bg-panel2 p-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-sm font-bold text-ok">{t('board.test.heading')}</span>
            <span className="text-[11px] text-slate-400">
              {connected ? t('board.test.instruction') : t('board.test.disconnected')}
            </span>
            {/* Whether the suspend actually took is the board's word, not ours: the
                write needs Idle, so a machine sitting in Alarm keeps its hard limits
                and the presses WILL alarm. Say which of the two is true. */}
            <span className={`ml-auto font-mono text-[10px] ${limitsOff ? 'text-warn' : 'text-danger'}`}>
              {limitsOff ? t('board.test.limitsOff') : t('board.test.limitsOn')}
            </span>
          </div>
          {/* say where the Jog panel went, and how to get it back — the cover is
              there to make jogging a decision instead of a reflex, not to forbid it */}
          <p className="text-[10px] leading-snug text-slate-500">{t('board.test.jogHint')}</p>
          {/* One framed cell per input. The frame is not decoration: the state mark
              sits at the right edge of its own cell, and without a border it reads as
              belonging to the neighbouring input instead. */}
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-5 gap-1.5 overflow-y-auto">
            {CONNECTORS.filter((c) => PIN_SIGNALS[c.id]).map((c) => {
              const firing = !!activeIds[c.id]
              const done = !!seen[c.id]
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition ${
                    firing ? 'border-white bg-white/10' : done ? 'border-ok/50 bg-ok/5' : 'border-border'
                  }`}
                  title={c.label}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${firing ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: firing ? '#ffffff' : done ? GROUP_COLOR[c.group] : '#33415580' }}
                  />
                  <span className={`truncate ${firing ? 'text-slate-100' : done ? 'text-slate-300' : 'text-slate-500'}`}>
                    {c.label.split(' · ')[0]}
                  </span>
                  <span className={`ml-auto shrink-0 text-[10px] ${firing ? 'text-slate-100' : done ? 'text-ok' : 'text-slate-600'}`}>
                    {firing ? t('board.test.now') : done ? '✓' : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : sel ? (
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
