/**
 * Live drawing of the stock block, drawn from the numbers the user is typing.
 * The proportions follow the real dimensions (a thin sheet looks like a sheet,
 * a long bar like a bar), the dimension lines carry the actual values, and the
 * green dot marks where the work zero sits — which is the part people get wrong.
 *
 * Isometric for the box, side-on for the rotary bar, so each reads at a glance.
 * All colours come from theme tokens, so it works in every theme.
 */

/** 2:1 isometric projection. +X right-down, +Y left-down, +Z up. */
const COS30 = 0.866
function iso(x: number, y: number, z: number): [number, number] {
  return [(x - y) * COS30, (x + y) * 0.5 - z]
}

/** Scale real mm to drawing units: the largest dimension fills `span`, and every
 *  axis keeps a visible minimum so a 3 mm sheet still reads as a solid. */
function fit(dims: number[], span: number, min: number): number[] {
  const max = Math.max(...dims.map((d) => (isFinite(d) && d > 0 ? d : 0)), 1)
  return dims.map((d) => Math.max(min, ((isFinite(d) && d > 0 ? d : 0) / max) * span))
}

function Dim({
  x1,
  y1,
  x2,
  y2,
  label,
  side = 1
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  /** which side of the line the text sits on */
  side?: number
}): JSX.Element {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  // offset the label perpendicular to the line so it never sits on top of it
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = (-dy / len) * 12 * side
  const ny = (dx / len) * 12 * side
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        className="stroke-brand/60"
        strokeWidth="1"
        strokeDasharray="3 2"
      />
      <text
        x={mx + nx}
        y={my + ny}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-slate-400 font-mono"
        fontSize="10"
      >
        {label}
      </text>
    </g>
  )
}

export function StockDiagram({
  mode,
  rotaryShape,
  rotaryAxis,
  zOrigin,
  originCorner,
  x,
  y,
  z,
  diameter,
  side,
  sideH,
  length,
  dimmed
}: {
  mode: 'box' | 'rotary'
  rotaryShape: 'round' | 'square'
  rotaryAxis: 'X' | 'Y'
  zOrigin: 'top' | 'bottom'
  originCorner: 'FL' | 'FR' | 'BL' | 'BR' | 'C'
  x: number
  y: number
  z: number
  diameter: number
  side: number
  sideH: number
  length: number
  dimmed: boolean
}): JSX.Element {
  const W = 300
  const H = 190
  const wrap = `w-full max-w-[340px] transition-opacity ${dimmed ? 'opacity-30' : 'opacity-100'}`

  if (mode === 'box') {
    const [dx, dy, dz] = fit([x, y, z], 92, 10)
    // Corners, projected. Y is mirrored into the projection so that +Y runs AWAY
    // from the viewer, matching the machine (+X right, +Y away): the front-left
    // corner then draws nearest, where the operator stands.
    const p = (a: number, b: number, c: number): [number, number] => iso(a, dy - b, c)
    const v000 = p(0, 0, 0)
    const v100 = p(dx, 0, 0)
    const v110 = p(dx, dy, 0)
    const v001 = p(0, 0, dz)
    const v101 = p(dx, 0, dz)
    const v111 = p(dx, dy, dz)
    const v011 = p(0, dy, dz)
    const all = [v000, v100, v110, v001, v101, v111, v011]
    const minX = Math.min(...all.map((v) => v[0]))
    const maxX = Math.max(...all.map((v) => v[0]))
    const minY = Math.min(...all.map((v) => v[1]))
    const maxY = Math.max(...all.map((v) => v[1]))
    const ox = (W - (maxX - minX)) / 2 - minX
    const oy = (H - (maxY - minY)) / 2 - minY - 6
    const t = (v: [number, number]): string => `${v[0] + ox},${v[1] + oy}`
    const pt = (v: [number, number]): [number, number] => [v[0] + ox, v[1] + oy]

    // work zero: the corner (or centre) the CAM job used, on the face the user picked
    const cz = zOrigin === 'top' ? dz : 0
    const zero = pt(
      p(
        originCorner === 'FR' || originCorner === 'BR' ? dx : originCorner === 'C' ? dx / 2 : 0,
        originCorner === 'BL' || originCorner === 'BR' ? dy : originCorner === 'C' ? dy / 2 : 0,
        cz
      )
    )
    // the centre marker sits ON the top face, so give it a leader line down to the
    // face rather than leaving it floating over the fill
    const zeroBase = originCorner === 'C' ? pt(p(dx / 2, dy / 2, 0)) : null

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={wrap}>
        {/* right face (darkest), front face, top face (lightest) */}
        <polygon
          points={`${t(v100)} ${t(v110)} ${t(v111)} ${t(v101)}`}
          className="fill-base stroke-border2"
          strokeWidth="1.5"
        />
        <polygon
          points={`${t(v000)} ${t(v100)} ${t(v101)} ${t(v001)}`}
          className="fill-panel2 stroke-border2"
          strokeWidth="1.5"
        />
        <polygon
          points={`${t(v001)} ${t(v101)} ${t(v111)} ${t(v011)}`}
          className="fill-panel stroke-border2"
          strokeWidth="1.5"
        />

        <Dim {...dimLine(pt(v000), pt(v100))} label={`X ${fmt(x)}`} side={-1} />
        <Dim {...dimLine(pt(v100), pt(v110))} label={`Y ${fmt(y)}`} />
        <Dim {...dimLine(pt(v110), pt(v111))} label={`Z ${fmt(z)}`} />

        {zeroBase && (
          <line
            x1={zero[0]}
            y1={zero[1]}
            x2={zeroBase[0]}
            y2={zeroBase[1]}
            className="stroke-ok/40"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        )}
        <circle cx={zero[0]} cy={zero[1]} r="5" className="fill-ok" />
        <text x={zero[0] - 8} y={zero[1] - 9} textAnchor="end" className="fill-ok font-mono" fontSize="10">
          {originCorner === 'C' ? 'C' : originCorner}
        </text>
      </svg>
    )
  }

  // --- rotary bar, seen from the side, spinning about the chosen axis ---------
  // seen from the side we look at its HEIGHT; the width shows in the section label
  const thick = rotaryShape === 'round' ? diameter : sideH
  const [bl, bt] = fit([length, thick], 150, 16)
  const cx = W / 2
  const cy = H / 2 - 4
  const x0 = cx - bl / 2
  const x1 = cx + bl / 2
  const ry = bt / 2
  const cap = Math.max(5, bt * 0.18) // ellipse minor axis for the round end cap

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={wrap}>
      {rotaryShape === 'round' ? (
        <>
          <rect
            x={x0}
            y={cy - ry}
            width={bl}
            height={bt}
            className="fill-panel2 stroke-border2"
            strokeWidth="1.5"
          />
          {/* end caps: the far one hinted, the near one solid */}
          <ellipse cx={x0} cy={cy} rx={cap} ry={ry} className="fill-base stroke-border2" strokeWidth="1.5" />
          <ellipse cx={x1} cy={cy} rx={cap} ry={ry} className="fill-panel stroke-border2" strokeWidth="1.5" />
        </>
      ) : (
        <>
          {/* square billet: body + a chamfered top face to read as 3D */}
          <rect
            x={x0}
            y={cy - ry}
            width={bl}
            height={bt}
            className="fill-panel2 stroke-border2"
            strokeWidth="1.5"
          />
          <polygon
            points={`${x0},${cy - ry} ${x0 + 10},${cy - ry - 9} ${x1 + 10},${cy - ry - 9} ${x1},${cy - ry}`}
            className="fill-panel stroke-border2"
            strokeWidth="1.5"
          />
          <polygon
            points={`${x1},${cy - ry} ${x1 + 10},${cy - ry - 9} ${x1 + 10},${cy + ry - 9} ${x1},${cy + ry}`}
            className="fill-base stroke-border2"
            strokeWidth="1.5"
          />
        </>
      )}

      {/* axis of rotation, running through the part and out both ends */}
      <line
        x1={x0 - 26}
        y1={cy}
        x2={x1 + 26}
        y2={cy}
        className="stroke-brand/70"
        strokeWidth="1"
        strokeDasharray="7 3 2 3"
      />
      {/* rotation arrow around the near end */}
      <path
        d={`M ${x1 + 14} ${cy - ry - 4} A ${cap + 12} ${ry + 8} 0 1 1 ${x1 + 14} ${cy + ry + 4}`}
        className="fill-none stroke-ok"
        strokeWidth="2"
        markerEnd="url(#rot)"
      />
      <text x={x1 + 30} y={cy - ry - 12} className="fill-ok font-display font-bold" fontSize="12">
        A
      </text>

      <Dim x1={x0} y1={cy + ry + 20} x2={x1} y2={cy + ry + 20} label={`L ${fmt(length)}`} />
      <Dim
        x1={x0 - 16}
        y1={cy - ry}
        x2={x0 - 16}
        y2={cy + ry}
        label={rotaryShape === 'round' ? `⌀ ${fmt(diameter)}` : `${fmt(side)}×${fmt(sideH)}`}
      />

      <text x={cx} y={H - 6} textAnchor="middle" className="fill-slate-500 font-mono" fontSize="10">
        {`⟳ ${rotaryAxis}`}
      </text>

      <defs>
        <marker id="rot" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" className="fill-ok" />
        </marker>
      </defs>
    </svg>
  )
}

function dimLine(
  a: [number, number],
  b: [number, number]
): { x1: number; y1: number; x2: number; y2: number } {
  return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }
}

/** Trim trailing zeros — 120 not 120.000, 12.5 stays 12.5. */
function fmt(v: number): string {
  if (!isFinite(v)) return '—'
  return `${Math.round(v * 100) / 100}`
}
