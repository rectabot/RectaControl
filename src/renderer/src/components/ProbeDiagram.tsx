/**
 * Interactive edge/corner picker (ioSender-style). Click an edge or the corner on
 * the workpiece; the green dot shows where to jog the probe first, the arrows show
 * the probe direction(s). Machine convention: +X right, +Y up.
 *
 * Outside faces only. It used to draw a pocket too, with the tool inside probing
 * outward — dropped on 3 Aug 2026 on Filip's call ("we don't need internal edge
 * measuring for now, only external"), never having been run on a machine. The
 * pocket hotspots and the routine behind them are in `.private/probeAdvanced.ts.txt`
 * and in git history.
 */
/** Where the tool is put and which face(s) it walks into. Which of those contacts
 *  turns into a zero is the panel's question, not the drawing's — the same corner
 *  serves XY0 and XYZ0. */
export type ProbeSpot = 'x' | 'y' | 'corner'

interface Hot {
  spot: ProbeSpot
  /** where the green dot (probe start) sits, viewBox coords */
  pos: [number, number]
  /** probe direction(s) as unit vectors in SVG space (+x right, +y DOWN) */
  dirs: [number, number][]
}

/**
 * The tool sits OUTSIDE the block and probes inward toward its faces.
 * (+Y up in machine = −y in SVG, so a "probe +Y" arrow points up = [0,-1].)
 *
 * Everything here belongs to ONE corner: the left face, the front face, and the
 * front-left corner where they meet.
 *
 * All four corners and all four edges used to be offered, and that was a quiet way
 * to lose a part. Zeroing against the far side is not a mirror image, which somebody
 * would notice — it is a clean shift of the whole cut by the width of the stock, so
 * the machine carves the table beside a workpiece it never touches. CAM puts the
 * origin front-left and the app already locks the homing corner there, so the back
 * and right faces had nothing to offer but that mistake: an X zero taken on the
 * right face is the same error as the corner, one axis at a time.
 */
const HOTS: Hot[] = [
  { spot: 'x', pos: [28, 100], dirs: [[1, 0]] },
  { spot: 'y', pos: [100, 172], dirs: [[0, -1]] },
  { spot: 'corner', pos: [30, 170], dirs: [[1, 0], [0, -1]] }
]

export function ProbeDiagram({
  spot,
  onSelect
}: {
  spot: ProbeSpot
  /** omit to make the drawing read-only */
  onSelect?: (s: ProbeSpot) => void
}): JSX.Element {
  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[280px]">
      <rect x="55" y="55" width="90" height="90" rx="3" className="fill-panel2 stroke-border2" strokeWidth="2" />

      {HOTS.map((h) => {
        const active = spot === h.spot
        return (
          <g key={h.spot} className={onSelect ? 'cursor-pointer' : ''} onClick={() => onSelect?.(h.spot)}>
            {/* arrows (only for the active pick, for clarity) */}
            {active &&
              h.dirs.map((d, i) => {
                const [x, y] = h.pos
                const x2 = x + d[0] * 20
                const y2 = y + d[1] * 20
                return (
                  <line
                    key={i}
                    x1={x}
                    y1={y}
                    x2={x2}
                    y2={y2}
                    className="stroke-brand"
                    strokeWidth="2.5"
                    markerEnd="url(#pa)"
                  />
                )
              })}
            {/* hit target + dot */}
            <circle cx={h.pos[0]} cy={h.pos[1]} r="12" fill="transparent" />
            <circle
              cx={h.pos[0]}
              cy={h.pos[1]}
              r={active ? 6 : 4}
              className={active ? 'fill-ok' : `fill-slate-500 ${onSelect ? 'hover:fill-slate-300' : ''}`}
            />
          </g>
        )
      })}

      <defs>
        <marker id="pa" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" className="fill-brand" />
        </marker>
      </defs>
    </svg>
  )
}
