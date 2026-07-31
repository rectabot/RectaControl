/** The touch plate, drawn and dimensioned from the numbers you typed.
 *
 *  A real XYZ plate is one machined part doing three jobs: a field you touch DOWN
 *  onto, and two raised rails along adjacent edges you touch SIDEWAYS against,
 *  with a relief groove between them so the tool cannot foul the inside corner.
 *  Numbers from the shelf, for scale: the Ottertools plate is 90 × 90 × 8 with a
 *  3 mm pocket, so its field is 5 mm and its rails stand 3 mm proud.
 *
 *  Built from the fields rather than drawn once, because these plates get MADE.
 *  A fixed picture of somebody else's plate teaches the wrong measurement, and
 *  typing 100 × 100 with a 10 mm rail and seeing exactly that come back is how you
 *  catch the day the rail width went into the Z thickness box — the mistake that
 *  costs a workpiece, and the one no validation can catch, because both numbers
 *  are perfectly valid on their own.
 */

import { useT } from '../i18n'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const num = (v: number): string => (Math.round(v * 100) / 100).toString()

/** The plate's isometric footprint is always drawn this wide, whatever it
 *  measures — a 60 mm plate and a 200 mm plate both fill the box, and it is the
 *  SHAPE that changes. */
const SPAN = 280

/** The drawn footprint. Not a setting: every plate on the market is a different
 *  square and none of that squareness measures anything, so the outer size is a
 *  stage the rails stand on, nothing more. Rails are clamped to a third of it, so
 *  the drawing keeps the rail-to-field proportion readable at any rail width. */
const FOOTPRINT = 100

export interface PlateShape {
  thickness: number
  /** rail `a` — the wall the tool meets probing X */
  railX: number
  /** rail `b` — the wall the tool meets probing Y */
  railY: number
}

/** Axis colours, the way every CAD viewport draws them: X red, Y green, Z blue.
 *
 *  Better than one accent colour, because then a dimension says WHICH axis it
 *  moves before it is read — and on this plate that is the entire risk. Rail a and
 *  rail b look identical and land in different zeros. */
const AX_X = '#ff3131'
const AX_Y = '#22e06b'
const AX_Z = '#2e7bff'

/** Arrowheads on a dimension, drawn along the line's own direction so a dimension
 *  parallel to an isometric edge still looks like one. */
function tick(x: number, y: number, dx: number, dy: number): string {
  const a = 3
  const nx = -dy
  const ny = dx
  return `M${x} ${y} l${(dx * a + nx * 1.7).toFixed(1)} ${(dy * a + ny * 1.7).toFixed(1)} M${x} ${y} l${(dx * a - nx * 1.7).toFixed(1)} ${(dy * a - ny * 1.7).toFixed(1)}`
}

/** One dimension between two screen points, pushed out along a unit normal. */
function Dim({
  ax,
  ay,
  bx,
  by,
  nx,
  ny,
  off,
  label,
  color,
  upright = false
}: {
  ax: number
  ay: number
  bx: number
  by: number
  nx: number
  ny: number
  off: number
  label: string
  color: string
  /** Keep the figure level instead of leaning with the line. For an upright
   *  dimension, leaning means reading the number sideways — the one case where
   *  matching the drawing costs more than it gives. */
  upright?: boolean
}): JSX.Element {
  const x1 = ax + nx * off
  const y1 = ay + ny * off
  const x2 = bx + nx * off
  const y2 = by + ny * off
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const ux = (x2 - x1) / len
  const uy = (y2 - y1) / len

  // The figure lies along its own dimension line, the way a CAD drawing sets it —
  // so on an isometric view the text leans with the edge it measures instead of
  // floating flat over it. Flipped past vertical so it never reads upside down.
  const deg = (Math.atan2(uy, ux) * 180) / Math.PI
  const lean = upright ? 0 : deg > 90 || deg < -90 ? deg + 180 : deg
  const tx = (x1 + x2) / 2 + nx * 10
  const ty = (y1 + y2) / 2 + ny * 10

  return (
    <g stroke={color} strokeWidth={1} fill="none">
      {/* witness lines back to the feature, so the dimension points at something */}
      <line x1={ax} y1={ay} x2={x1 + nx * 2} y2={y1 + ny * 2} strokeWidth={0.7} strokeOpacity={0.6} />
      <line x1={bx} y1={by} x2={x2 + nx * 2} y2={y2 + ny * 2} strokeWidth={0.7} strokeOpacity={0.6} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <path d={tick(x1, y1, ux, uy)} />
      <path d={tick(x2, y2, -ux, -uy)} />
      <text
        x={tx}
        y={ty}
        transform={`rotate(${lean.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})`}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        strokeWidth={0}
        fontFamily="ui-monospace, monospace"
        fill={color}
      >
        {label}
      </text>
    </g>
  )
}

export function TouchPlateDiagram({ shape }: { shape: PlateShape }): JSX.Element {
  const t = useT()

  // A half-typed field is a number too: "10" on its way to "100" passes through
  // values that would divide by zero or draw a rail wider than the plate.
  const W = FOOTPRINT
  const D = FOOTPRINT
  // Rail `a` stands along the Y edge, so its WALL faces X — that is the one a tool
  // probing X meets, and why the X rail is measured across the x direction here.
  const Rx = clamp(shape.railX, 0.5, W / 3)
  const Ry = clamp(shape.railY, 0.5, D / 3)
  const T = clamp(shape.thickness, 0.2, 60)
  // How far the rails stand proud is not a setting: no cycle reads it, and asking
  // for a number nobody's zero depends on is asking for a number to get wrong.
  // Drawn proportional to the field, which is the only thing it has to look right
  // against — and it is the one dimension here deliberately not dimensioned.
  const TOP = T + Math.max(2, T * 0.7)
  const Gx = Rx + Math.max(1.5, Rx * 0.18) // relief groove ends here
  const Gy = Ry + Math.max(1.5, Ry * 0.18)

  const S = SPAN / ((W + D) * 0.866)
  const OX = 92 + D * 0.866 * S
  const OY = 74 + TOP * S

  /** +x to the lower right, +y to the lower left, +z up: the rails sit at the back
   *  and the field opens toward you, the way it lies on your own table. */
  const px = (x: number, y: number): number => OX + (x - y) * 0.866 * S
  const py = (x: number, y: number, z: number): number => OY + (x + y) * 0.5 * S - z * S
  const p = (x: number, y: number, z: number): string => `${px(x, y).toFixed(1)},${py(x, y, z).toFixed(1)}`
  const poly = (pts: [number, number, number][]): string => pts.map(([x, y, z]) => p(x, y, z)).join(' ')

  // A circle lying flat projects to an axis-aligned ellipse — the half-axes just
  // scale differently (0.866·√2 and 0.5·√2), so no rotation is needed.

  // unit normals pointing away from the solid, along the two isometric directions

  return (
    <svg viewBox="0 0 460 340" className="h-auto w-full" role="img" aria-label={t('ui.probeSet.plateAlt')}>
      {/* Shaded like a CAD render rather than flat-filled: three face gradients for
          the three isometric orientations, thin dark edges, and a soft contact
          shadow. It is aluminium — reading as metal is most of what makes the
          picture recognisable as the thing on your bench. */}
      <defs>
        {/* Two tones, not three: every upright face is an X or Y face and carries
            the same shade, and only the horizontal Z faces differ. Flatter than
            true lighting, and it reads the way a CAD viewport does — the eye takes
            "same shade" as "same orientation", which is exactly the point here. */}
        <linearGradient id="tp-top" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#eef2f7" />
          <stop offset="100%" stopColor="#cdd5df" />
        </linearGradient>
        <linearGradient id="tp-side" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#9aa4b2" />
          <stop offset="100%" stopColor="#7d8794" />
        </linearGradient>
        <linearGradient id="tp-groove" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#5b6675" />
          <stop offset="100%" stopColor="#39424f" />
        </linearGradient>
        <filter id="tp-shadow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        {/* The corner relief is a bore drilled ON the inside corner, so from above
            you see only the part of it that falls on the field — the rest opens
            into the two walls. Clipping to the field is what draws that, instead
            of a full ellipse floating over the walls. */}
        <clipPath id="tp-field">
          <polygon points={poly([[Rx, Ry, T], [W, Ry, T], [W, D, T], [Rx, D, T]])} />
        </clipPath>
      </defs>

      {/* contact shadow — the plate is lying on something */}
      <ellipse
        cx={px(W / 2, D / 2)}
        cy={py(W / 2, D / 2, 0) + 10}
        rx={SPAN * 0.46}
        ry={SPAN * 0.24}
        fill="#0b1220"
        opacity={0.45}
        filter="url(#tp-shadow)"
      />

      <g strokeLinejoin="round" strokeWidth={0.7} stroke="#3f4a5a">
        {/* rail tops — one L-shaped face along two adjacent edges */}
        <polygon
          fill="url(#tp-top)"
          points={poly([
            [0, 0, TOP],
            [W, 0, TOP],
            [W, Ry, TOP],
            [Rx, Ry, TOP],
            [Rx, D, TOP],
            [0, D, TOP]
          ])}
        />

        {/* the rails' inner walls — what the tool touches probing X or Y */}
        <polygon fill="url(#tp-side)" points={poly([[Rx, Ry, TOP], [W, Ry, TOP], [W, Ry, T], [Rx, Ry, T]])} />
        <polygon fill="url(#tp-side)" points={poly([[Rx, Ry, TOP], [Rx, D, TOP], [Rx, D, T], [Rx, Ry, T]])} />

        {/* where each rail runs out at the plate edge */}
        <polygon fill="url(#tp-side)" points={poly([[W, 0, TOP], [W, Ry, TOP], [W, Ry, T], [W, 0, T]])} />
        <polygon fill="url(#tp-side)" points={poly([[0, D, TOP], [Rx, D, TOP], [Rx, D, T], [0, D, T]])} />

        {/* the field — where a Z touch-off lands */}
        <polygon fill="url(#tp-top)" points={poly([[Rx, Ry, T], [W, Ry, T], [W, D, T], [Rx, D, T]])} />

        {/* relief grooves at the inside corner */}
        <polygon fill="url(#tp-groove)" strokeWidth={0.5} points={poly([[Rx, Ry, T], [W, Ry, T], [W, Gy, T], [Rx, Gy, T]])} />
        <polygon fill="url(#tp-groove)" strokeWidth={0.5} points={poly([[Rx, Gy, T], [Gx, Gy, T], [Gx, D, T], [Rx, D, T]])} />

        {/* corner relief, clipped to the field (see the clipPath) */}
        <g clipPath="url(#tp-field)">
          <ellipse
            cx={px(Rx, Ry)}
            cy={py(Rx, Ry, T)}
            rx={1.225 * S * Math.max(Math.min(Rx, Ry) * 0.42, 1.5)}
            ry={0.707 * S * Math.max(Math.min(Rx, Ry) * 0.42, 1.5)}
            fill="url(#tp-groove)"
            stroke="#39424f"
            strokeWidth={0.7}
          />
        </g>

        {/* the slab's two visible sides */}
        <polygon fill="url(#tp-side)" points={poly([[W, 0, T], [W, D, T], [W, D, 0], [W, 0, 0]])} />
        <polygon fill="url(#tp-side)" points={poly([[0, D, T], [W, D, T], [W, D, 0], [0, D, 0]])} />

        {/* A machined edge is never a perfect line — the thin light catch along the
            two top edges is what stops the whole thing reading as a flat cut-out. */}
        <g stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.9} fill="none">
          <line x1={px(0, 0)} y1={py(0, 0, TOP)} x2={px(W, 0)} y2={py(W, 0, TOP)} />
          <line x1={px(0, 0)} y1={py(0, 0, TOP)} x2={px(0, D)} y2={py(0, D, TOP)} />
        </g>

      </g>

      {/* Three numbers, and all three pushed clear of the solid. A dimension that
          crosses the part it measures is the one thing worse than no dimension:
          every normal below points AWAY from the body, so the lines and the
          figures sit on empty paper.

          The outer size is not among them — it is not a setting, and a dimension
          on a made-up number would be a confident lie. */}
      {/* field thickness, on the near corner where both side faces meet */}
      <Dim ax={px(W, D)} ay={py(W, D, 0)} bx={px(W, D)} by={py(W, D, T)} nx={1} ny={0} off={18} label={num(T)} color={AX_Z} upright />

      {/* Each rail across its own end face, and named. The letters are the whole
          point once the two differ: a is the wall a tool probing X meets, b the one
          it meets probing Y, and the note beside the drawing ties that to the
          front-left corner so there is one right way round. */}
      <Dim
        ax={px(W, 0)}
        ay={py(W, 0, TOP)}
        bx={px(W, Ry)}
        by={py(W, Ry, TOP)}
        nx={0.866}
        ny={0.5}
        off={18}
        label={`b ${num(Ry)}`}
        color={AX_Y}
      />
      <Dim
        ax={px(0, D)}
        ay={py(0, D, TOP)}
        bx={px(Rx, D)}
        by={py(Rx, D, TOP)}
        nx={-0.866}
        ny={0.5}
        off={18}
        label={`a ${num(Rx)}`}
        color={AX_X}
      />
    </svg>
  )
}

/** Looking straight down at one edge, mid-probe: where the tool stops and where
 *  the material actually is. Two offsets separate them and both are typed in by
 *  hand, so both are drawn — this is the picture behind `⌀/2 + rail` in runEdge. */
export function EdgeOffsetDetail({ tipDiameter, rail }: { tipDiameter: number; rail: number }): JSX.Element {
  const t = useT()
  // The real radius is what every FIGURE reports; the drawn one is capped at a
  // 25 mm tool so a big cutter cannot push the circle out of the frame. Run any
  // tool you like — the limit is on the picture, never on the number, and the
  // dimensions keep telling the truth after the circle stops growing.
  const r = Math.max(tipDiameter, 0) / 2
  const rDraw = clamp(tipDiameter, 0.2, 25) / 2
  const R = clamp(rail, 0, 60)

  // One scale for both offsets, so the two are honestly comparable — sized to fill
  // the width. But that budget is the SUM, and in direct-touch mode the rail is
  // zero and the tool inherits all of it: a 25 mm cutter then asks for a 150 px
  // radius and leaves the frame top and bottom. So the height gets a say too, and
  // whichever limit bites first wins.
  const s = clamp(Math.min(150 / Math.max(rDraw + R, 4), 60 / Math.max(rDraw, 0.5)), 2, 14)
  const EDGE = 300 // the material edge, in screen units
  const contact = EDGE - R * s
  const centre = contact - rDraw * s

  return (
    // Framed on the content, not on the origin. Everything drawn lives between the
    // total's figure at the top and the two halves' figures at the bottom, centred
    // on the tool at y=76 — so the box is centred there too and there is no dead
    // band above or below whatever the tool size does to the circle.
    <svg viewBox="0 -9 420 170" className="h-auto w-full" role="img" aria-label={t('ui.probeSet.edgeAlt')}>
      {/* material: it ends at EDGE, and everything to the left of that is air */}
      <rect x={EDGE} y={28} width={110} height={96} className="fill-slate-800 stroke-slate-600" strokeWidth={1.4} />
      {/* Drawn for X, so the whole picture wears the X colour — the same move in Y
          is the same picture in green, and drawing it twice would say nothing. */}
      <line x1={EDGE} y1={28} x2={EDGE} y2={124} stroke={AX_X} strokeWidth={1.6} />

      {/* The rail, sitting over the material edge: its outer face is flush with the
          material face, so its inner wall is exactly one rail width inside. With no
          plate there is no rail — the tool stops on the material itself, and the
          drawing has to say that rather than draw a strip of nothing. */}
      {R > 0 && <rect x={contact} y={40} width={EDGE - contact} height={72} className="fill-slate-300 stroke-slate-500" strokeWidth={1.2} />}

      {/* the tool, stopped against the rail's inner wall */}
      <circle cx={centre} cy={76} r={rDraw * s} className="fill-slate-600 stroke-slate-300" strokeWidth={1.4} />
      <line x1={centre} y1={62} x2={centre} y2={90} className="stroke-slate-400" strokeWidth={0.8} strokeDasharray="3 2" />
      {/* The tool's own diameter, written in the tool — a circle drawn to scale is
          already telling you the size, and the number turns that into something you
          can check against the field you typed it in. Skipped when the circle is too
          small to hold it, because a number spilling out of its own shape is worse
          than none. */}
      {rDraw * s >= 11 && (
        <text
          x={centre}
          y={76}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.min(rDraw * s * 0.62, 15)}
          fontWeight={600}
          fontFamily="ui-monospace, monospace"
          fill="#2ce8ff"
        >
          ⌀{num(r * 2)}
        </text>
      )}
      {/* Starts out near the rim, not at the centre — the diameter now sits in the
          middle of the circle, and an arrow growing out of the figure reads as part
          of it. It only has to show which way the tool went. */}
      <path d={`M${centre + rDraw * s * 0.58} 76 H${contact}`} stroke={AX_X} strokeWidth={1.3} fill="none" />
      <path d={`M${contact} 76 l-4 -2.4 M${contact} 76 l-4 2.4`} stroke={AX_X} strokeWidth={1.3} fill="none" />

      {/* the two offsets, end to end, and their sum — the sum is worth drawing even
          when it is only one of them, because it is the number that moves the zero */}
      {/* Anchored on the material's own bottom edge and pushed clear from there, so
          the two halves sit as far off the drawing as the total does above it —
          three dimensions at three different distances read as three unrelated
          things, and these are one sum and its parts. */}
      <Dim ax={centre} ay={124} bx={contact} by={124} nx={0} ny={1} off={14} label={num(r)} color={AX_X} />
      {R > 0 && <Dim ax={contact} ay={124} bx={EDGE} by={124} nx={0} ny={1} off={14} label={num(R)} color={AX_X} />}
      <Dim ax={centre} ay={28} bx={EDGE} by={28} nx={0} ny={-1} off={14} label={num(r + R)} color={AX_X} />
    </svg>
  )
}
