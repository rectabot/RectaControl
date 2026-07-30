/** What the selected firmware image will drive, drawn.
 *
 *  The badges beside the list say how an image *differs* from the board, which
 *  makes them silent exactly when they are needed most: no connection, an older
 *  build with no stamp, a board that is not ours. This says what the image *is*,
 *  so it is never silent.
 *
 *  It exists because of 29 Jul 2026. A single-Y image went onto a dual-Y gantry
 *  and the label read "4-axis (X/Y/Z + rotary A)" — every word of it true, and
 *  silent about the one thing that mattered. The mistake was not misreading a
 *  warning; it was skimming a sentence. One motor against two is a shape, and a
 *  shape is checked before it is read.
 *
 *  Everything here is derived from `VariantConfig`, which `readConfig()` parses
 *  out of the variant's own `build.conf` — the same file the build script compiles
 *  from, and the same source the pre-flash check uses. Nothing is drawn per
 *  variant by hand: a picture that drifts from the file is worse than no picture,
 *  because it is a confident lie about the only thing anyone is looking at.
 */

import { useT } from '../i18n'
import type { VariantConfig } from '@shared/types'

const BRAND = '#22d3ee'
const RAIL = '#334155'
const WARN = '#fbbf24'

/** One stepper. Drawn as a labelled block, because that is how it sits on a
 *  machine and how it appears on the board's own connector row. */
function Motor({ x, y, label }: { x: number; y: number; label: string }): JSX.Element {
  return (
    <g>
      <rect x={x} y={y} width={26} height={17} rx={2.5} fill={BRAND} fillOpacity={0.16} stroke={BRAND} strokeWidth={1.4} />
      <text x={x + 13} y={y + 12} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" fill={BRAND}>
        {label}
      </text>
    </g>
  )
}

/** A homing switch. Two of them on the Y rails is the whole visible difference
 *  between auto-squaring and ganging — the one distinction the app cannot make
 *  from outside once the image is on the board. */
function HomeSwitch({ x, y }: { x: number; y: number }): JSX.Element {
  return <circle cx={x} cy={y} r={4} fill={WARN} fillOpacity={0.25} stroke={WARN} strokeWidth={1.3} />
}

export function VariantDiagram({ config }: { config: VariantConfig | null }): JSX.Element {
  const t = useT()

  // No build.conf, no drawing. An image we cannot describe must not be described:
  // the pre-flash check treats silence as "unknown" for the same reason.
  if (!config) return <div className="font-mono text-[10px] text-slate-500">{t('ui.fwDiag.unknown')}</div>

  const dualY = config.secondMotor.includes('Y')
  const rotary = config.axes >= 4
  const tilt = config.axes >= 5
  const letters = ['X', 'Y', 'Z', 'A', 'B'].slice(0, config.axes)

  const caption = dualY
    ? config.autoSquare
      ? t('ui.fwDiag.dualAuto')
      : t('ui.fwDiag.dualGanged')
    : t('ui.fwDiag.singleY')

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-border bg-panel2 p-3">
      <svg viewBox="0 0 320 190" className="max-h-full w-full max-w-[460px]" role="img" aria-label={caption}>
        {/* bed */}
        <rect x={40} y={24} width={240} height={132} rx={5} fill="#0f172a" stroke={RAIL} strokeWidth={1.5} />

        {/* Y rails — always two, because the machine has two sides whatever the
            firmware does with them. What differs is how many are driven. */}
        <rect x={44} y={24} width={10} height={132} fill={RAIL} />
        <rect x={266} y={24} width={10} height={132} fill={RAIL} />

        {/* gantry beam and the head riding on it */}
        <rect x={44} y={62} width={232} height={14} rx={2} fill={RAIL} />
        <rect x={146} y={54} width={32} height={30} rx={3} fill={BRAND} fillOpacity={0.16} stroke={BRAND} strokeWidth={1.4} />
        <text x={162} y={73} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" fill={BRAND}>
          {tilt ? 'ZB' : 'Z'}
        </text>

        {/* Rotary A: the chuck end-on with the bar in it — what you actually see
            standing over the machine. The circle is drawn as an arc with a gap at
            the top so the gap can carry an arrowhead: a plain circle beside a bar
            is also what a clamp looks like, and what a fixture looks like, and the
            one thing this axis does that they do not is turn. Low and to the left,
            clear of the beam above and the Y motor below. */}
        {rotary && (
          <g>
            {/* the bar is stock, not a driven part — the same grey as the rails and
                the beam, so the only thing wearing the axis colour is the axis */}
            <rect x={124} y={108} width={104} height={16} rx={2} fill={RAIL} />
            <path d="M 117 103.9 A 14 14 0 1 1 103 103.9" fill="none" stroke={BRAND} strokeWidth={1.8} strokeLinecap="round" />
            <path d="M 107.3 101.4 L 103.1 107.9 L 99.6 101.9 Z" fill={BRAND} />
            <text x={110} y={120} textAnchor="middle" fontSize={11} fontFamily="ui-monospace, monospace" fill={BRAND}>
              A
            </text>
          </g>
        )}

        {/* X drives the beam along the gantry */}
        <Motor x={8} y={61} label="X" />

        {/* The Y motors — the reason this drawing exists. Two of them sit at the
            feet of the rails, one on each side. A single one goes in the middle:
            hanging it off one rail would say the left side is driven and the right
            is not, which is a different machine from one with a single central
            drive, and the drawing has no business claiming to know which. */}
        {dualY ? (
          <>
            <Motor x={31} y={162} label="Y" />
            <Motor x={263} y={162} label="Y2" />
          </>
        ) : (
          <Motor x={147} y={162} label="Y" />
        )}

        {/* Homing switches: one for a ganged pair (they home as one motor), one per
            rail when the firmware squares the gantry against both. */}
        <HomeSwitch x={49} y={32} />
        {dualY && config.autoSquare && <HomeSwitch x={271} y={32} />}
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {letters.map((l) => (
          <span key={l} className="rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand">
            {l}
          </span>
        ))}
        <span className={`ml-1 font-mono text-[10px] ${dualY ? 'text-slate-400' : 'text-warn'}`}>{caption}</span>
      </div>
    </div>
  )
}
