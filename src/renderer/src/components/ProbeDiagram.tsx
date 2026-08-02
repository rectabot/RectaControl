/**
 * Interactive edge/corner picker (ioSender-style). Click an edge or corner on the
 * workpiece; the green dot shows where to jog the probe first, the arrows show the
 * probe direction(s). Machine convention: +X right, +Y up. Themed to RectaControl.
 */
export type ProbeSel =
  | { key: string; kind: 'edge'; axis: 'X' | 'Y'; dir: 1 | -1 }
  | { key: string; kind: 'corner'; xDir: 1 | -1; yDir: 1 | -1 }

interface Hot {
  sel: ProbeSel
  /** where the green dot (probe start) sits, viewBox coords */
  pos: [number, number]
  /** probe direction(s) as unit vectors in SVG space (+x right, +y DOWN) */
  dirs: [number, number][]
}

// external: tool sits OUTSIDE the block and probes inward toward its faces.
// (+Y up in machine = −y in SVG, so a "probe +Y" arrow points up = [0,-1].)
const EXTERNAL: Hot[] = [
  { sel: { key: 'e-l', kind: 'edge', axis: 'X', dir: 1 }, pos: [28, 100], dirs: [[1, 0]] },
  { sel: { key: 'e-r', kind: 'edge', axis: 'X', dir: -1 }, pos: [172, 100], dirs: [[-1, 0]] },
  { sel: { key: 'e-b', kind: 'edge', axis: 'Y', dir: -1 }, pos: [100, 28], dirs: [[0, 1]] },
  { sel: { key: 'e-f', kind: 'edge', axis: 'Y', dir: 1 }, pos: [100, 172], dirs: [[0, -1]] },
  { sel: { key: 'c-fl', kind: 'corner', xDir: 1, yDir: 1 }, pos: [30, 170], dirs: [[1, 0], [0, -1]] },
  { sel: { key: 'c-fr', kind: 'corner', xDir: -1, yDir: 1 }, pos: [170, 170], dirs: [[-1, 0], [0, -1]] },
  { sel: { key: 'c-bl', kind: 'corner', xDir: 1, yDir: -1 }, pos: [30, 30], dirs: [[1, 0], [0, 1]] },
  { sel: { key: 'c-br', kind: 'corner', xDir: -1, yDir: -1 }, pos: [170, 30], dirs: [[-1, 0], [0, 1]] }
]

// internal: tool sits INSIDE a pocket and probes outward toward its walls.
const INTERNAL: Hot[] = [
  { sel: { key: 'e-l', kind: 'edge', axis: 'X', dir: -1 }, pos: [86, 100], dirs: [[-1, 0]] },
  { sel: { key: 'e-r', kind: 'edge', axis: 'X', dir: 1 }, pos: [114, 100], dirs: [[1, 0]] },
  { sel: { key: 'e-b', kind: 'edge', axis: 'Y', dir: 1 }, pos: [100, 86], dirs: [[0, -1]] },
  { sel: { key: 'e-f', kind: 'edge', axis: 'Y', dir: -1 }, pos: [100, 114], dirs: [[0, 1]] },
  { sel: { key: 'c-fl', kind: 'corner', xDir: -1, yDir: -1 }, pos: [82, 118], dirs: [[-1, 0], [0, 1]] },
  { sel: { key: 'c-fr', kind: 'corner', xDir: 1, yDir: -1 }, pos: [118, 118], dirs: [[1, 0], [0, 1]] },
  { sel: { key: 'c-bl', kind: 'corner', xDir: -1, yDir: 1 }, pos: [82, 82], dirs: [[-1, 0], [0, -1]] },
  { sel: { key: 'c-br', kind: 'corner', xDir: 1, yDir: 1 }, pos: [118, 82], dirs: [[1, 0], [0, -1]] }
]

export function ProbeDiagram({
  internal,
  selectedKey,
  onSelect,
  edgesOnly = false,
  frontLeftOnly = false
}: {
  internal: boolean
  selectedKey: string | null
  onSelect: (sel: ProbeSel) => void
  /** hide corner hotspots — used by the rotation mode, which measures one edge */
  edgesOnly?: boolean
  /** Only the front-left corner, for the three-axis zero.
   *
   *  All four used to be offered, and that was a quiet way to lose a part. Zeroing
   *  the wrong corner is not a mirror image, which somebody would notice — it is a
   *  clean shift of the whole cut by the width of the stock, so the machine carves
   *  the table beside a workpiece it never touches. CAM output puts the origin at
   *  the front-left corner, the app already locks the homing corner there for the
   *  same reason, and a three-axis zero that can land anywhere else is the one
   *  choice in this dialog with no good answer. Single-axis edges and the internal
   *  corner stay open: those are for pockets and for zeroing one axis at a time,
   *  where the operator is choosing a feature rather than an origin. */
  frontLeftOnly?: boolean
}): JSX.Element {
  const hots = (internal ? INTERNAL : EXTERNAL).filter(
    (h) =>
      (!edgesOnly || h.sel.kind === 'edge') &&
      (!frontLeftOnly || h.sel.kind !== 'corner' || h.sel.key === 'c-fl')
  )
  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[280px]">
      {/* workpiece / pocket */}
      {internal ? (
        <>
          <rect x="20" y="20" width="160" height="160" rx="4" className="fill-panel2 stroke-border2" strokeWidth="2" />
          <rect x="60" y="60" width="80" height="80" rx="3" className="fill-base stroke-border2" strokeWidth="2" />
        </>
      ) : (
        <rect x="55" y="55" width="90" height="90" rx="3" className="fill-panel2 stroke-border2" strokeWidth="2" />
      )}

      {hots.map((h) => {
        const active = selectedKey === h.sel.key
        return (
          <g key={h.sel.key} className="cursor-pointer" onClick={() => onSelect(h.sel)}>
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
              className={active ? 'fill-ok' : 'fill-slate-500 hover:fill-slate-300'}
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
