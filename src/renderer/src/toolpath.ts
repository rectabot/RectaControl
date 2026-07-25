/**
 * Minimal G-code → toolpath geometry for the 3D viewer.
 * Handles G0/G1 line moves and G2/G3 arcs (XY plane, I/J or R), modal
 * absolute/incremental (G90/G91) and units (G20/G21). Good enough to preview
 * a program; not a full interpreter.
 */

export interface Toolpath {
  positions: Float32Array // flat x,y,z pairs per segment vertex
  colors: Float32Array // matching rgb per vertex
  min: [number, number, number]
  max: [number, number, number]
  hasGeometry: boolean
}

const RAPID = [0.28, 0.4, 0.55] // dim blue for G0
const CUT = [0.13, 0.83, 0.93] // brand cyan for G1/G2/G3

/** WCS offsets from `$#` (machine coords of each G54–G59 zero) so a multi-fixture
 *  program draws each block at its real position instead of overlapping. */
export interface WcoOpts {
  offsets?: Record<string, number[]>
  wcs?: string
  /** When set, wrap the program onto a rotary cylinder instead of drawing it flat:
   *  the chosen linear axis runs along the cylinder, A is the angle around it, and Z
   *  is depth from the surface (Z0 on the SURFACE: Z=0 sits on the skin at `radius`,
   *  negative Z cuts in). `origin` is the axis line (work origin, machine coords). */
  rotary?: RotaryOpt
}

export interface RotaryOpt {
  axis: 'X' | 'Y'
  origin: [number, number, number]
  /** Cylinder surface radius — a program Z of 0 wraps onto this radius. */
  radius: number
}

/** Map a rotary point to LOCAL cylinder coords (relative to the axis at the work
 *  origin), so the whole pattern can live in a group that spins to the live A angle.
 *  `along` = position down the axis, `mz` = machine Z (radial = radius + (mz-axisZ)),
 *  `aDeg` = angle. Angle 0 = +Z (top), matching the stock's reference stripe. */
function wrapPt(rot: RotaryOpt, along: number, mz: number, aDeg: number): [number, number, number] {
  // negative so the wrap winds the same way the material spins (see Visualizer's
  // rotaryGroup rotation) — the two share this chirality so the cut stays under the tool
  const th = (-aDeg * Math.PI) / 180
  const rho = rot.radius + (mz - rot.origin[2])
  const s = rho * Math.sin(th)
  const c = rho * Math.cos(th)
  return rot.axis === 'X' ? [along - rot.origin[0], s, c] : [s, along - rot.origin[1], c]
}

export function parseToolpath(gcode: string, opts: WcoOpts = {}): Toolpath {
  let abs = true
  let mm = true
  let motion = 0
  let a = 0 // modal A angle (degrees) — tracked for rotary wrapping
  const offsets = opts.offsets ?? {}
  const rot = opts.rotary
  let wco = offsets[opts.wcs ?? 'G54'] ?? [0, 0, 0]
  const pos = { x: 0, y: 0, z: 0 }
  const verts: number[] = []
  const cols: number[] = []
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]

  const track = (x: number, y: number, z: number): void => {
    min[0] = Math.min(min[0], x)
    min[1] = Math.min(min[1], y)
    min[2] = Math.min(min[2], z)
    max[0] = Math.max(max[0], x)
    max[1] = Math.max(max[1], y)
    max[2] = Math.max(max[2], z)
  }
  const seg = (x: number, y: number, z: number, rapid: boolean): void => {
    const c = rapid ? RAPID : CUT
    verts.push(pos.x, pos.y, pos.z, x, y, z)
    for (let i = 0; i < 2; i++) cols.push(c[0], c[1], c[2])
    track(pos.x, pos.y, pos.z)
    track(x, y, z)
  }
  const pushChord = (p: number[], q: number[], rapid: boolean): void => {
    const c = rapid ? RAPID : CUT
    verts.push(p[0], p[1], p[2], q[0], q[1], q[2])
    for (let i = 0; i < 2; i++) cols.push(c[0], c[1], c[2])
    track(p[0], p[1], p[2])
    track(q[0], q[1], q[2])
  }
  // Wrap a move onto the cylinder, subdivided by ΔA and length so a helix (X+A) or
  // a full turn (A only) curves smoothly instead of chording across the cylinder.
  const emitRotary = (tx: number, ty: number, tz: number, a1: number, rapid: boolean): void => {
    if (!rot) return
    const dist = Math.hypot(tx - pos.x, ty - pos.y, tz - pos.z)
    const steps = Math.min(2000, Math.max(1, Math.ceil(Math.max(Math.abs(a1 - a) / 4, dist / 2))))
    let prev = wrapPt(rot, rot.axis === 'X' ? pos.x : pos.y, pos.z, a)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const x = pos.x + (tx - pos.x) * t
      const y = pos.y + (ty - pos.y) * t
      const z = pos.z + (tz - pos.z) * t
      const aa = a + (a1 - a) * t
      const cur = wrapPt(rot, rot.axis === 'X' ? x : y, z, aa)
      pushChord(prev, cur, rapid)
      prev = cur
    }
  }

  for (const raw of gcode.split(/\r?\n/)) {
    const line = stripComment(raw).trim()
    if (!line) continue
    const words = line.toUpperCase().match(/[A-Z][-+0-9.]*/g)
    if (!words) continue

    const w: Record<string, number> = {}
    for (const tok of words) {
      const letter = tok[0]
      const val = parseFloat(tok.slice(1))
      if (letter === 'G') {
        if (val === 90) abs = true
        else if (val === 91) abs = false
        else if (val === 20) mm = false
        else if (val === 21) mm = true
        else if (val === 0 || val === 1 || val === 2 || val === 3) motion = val
        else if (Number.isInteger(val) && val >= 54 && val <= 59) wco = offsets['G' + val] ?? [0, 0, 0]
      } else if (!Number.isNaN(val)) {
        w[letter] = val
      }
    }

    const scale = mm ? 1 : 25.4
    const tx = w.X !== undefined ? (abs ? w.X * scale + wco[0] : pos.x + w.X * scale) : pos.x
    const ty = w.Y !== undefined ? (abs ? w.Y * scale + wco[1] : pos.y + w.Y * scale) : pos.y
    const tz = w.Z !== undefined ? (abs ? w.Z * scale + wco[2] : pos.z + w.Z * scale) : pos.z
    // A is in degrees regardless of G20/G21 units
    const aNew = w.A !== undefined ? (abs ? w.A : a + w.A) : a

    const moves = w.X !== undefined || w.Y !== undefined || w.Z !== undefined
    const aMove = w.A !== undefined
    if (!moves && !aMove && w.I === undefined && w.R === undefined) continue

    if (rot) {
      // rotary wrap treats G2/G3 as linear for now (arcs around a cylinder are rare)
      emitRotary(tx, ty, tz, aNew, motion === 0)
    } else if (motion === 2 || motion === 3) {
      arc(motion === 2, pos, tx, ty, tz, w, scale, seg)
    } else if (motion === 0) {
      seg(tx, ty, tz, true)
    } else {
      seg(tx, ty, tz, false)
    }
    pos.x = tx
    pos.y = ty
    pos.z = tz
    a = aNew
  }

  return {
    positions: new Float32Array(verts),
    colors: new Float32Array(cols),
    min,
    max,
    hasGeometry: verts.length > 0
  }
}

function arc(
  cw: boolean,
  pos: { x: number; y: number; z: number },
  tx: number,
  ty: number,
  tz: number,
  w: Record<string, number>,
  scale: number,
  seg: (x: number, y: number, z: number, rapid: boolean) => void
): void {
  // XY-plane arc (G17). Center via I/J, else derive from R.
  let cx: number, cy: number
  if (w.I !== undefined || w.J !== undefined) {
    cx = pos.x + (w.I ?? 0) * scale
    cy = pos.y + (w.J ?? 0) * scale
  } else if (w.R !== undefined) {
    const r = w.R * scale
    const mx = (pos.x + tx) / 2
    const my = (pos.y + ty) / 2
    const dx = tx - pos.x
    const dy = ty - pos.y
    const d = Math.hypot(dx, dy) || 1e-6
    const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2))
    const sign = cw ? -1 : 1
    cx = mx + sign * h * (-dy / d)
    cy = my + sign * h * (dx / d)
  } else {
    seg(tx, ty, tz, false)
    return
  }

  const a0 = Math.atan2(pos.y - cy, pos.x - cx)
  let a1 = Math.atan2(ty - cy, tx - cx)
  if (cw && a1 >= a0) a1 -= 2 * Math.PI
  if (!cw && a1 <= a0) a1 += 2 * Math.PI
  const r = Math.hypot(pos.x - cx, pos.y - cy)
  const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 64))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const a = a0 + (a1 - a0) * t
    seg(cx + r * Math.cos(a), cy + r * Math.sin(a), pos.z + (tz - pos.z) * t, false)
    pos.x = cx + r * Math.cos(a)
    pos.y = cy + r * Math.sin(a)
    pos.z = pos.z + (tz - pos.z) * t
  }
}

function stripComment(line: string): string {
  const semi = line.indexOf(';')
  const s = semi >= 0 ? line.slice(0, semi) : line
  return s.replace(/\([^)]*\)/g, '')
}

/**
 * Build a "start from line" program: replay modal state (units, distance mode,
 * feed, spindle, coolant) and position up to `targetIdx`, then emit a safe
 * preamble (lift to safeZ → rapid to XY → plunge to Z) followed by the rest of
 * the program. Coordinates are emitted in the program's own units.
 */
export interface ResumePlan {
  gcode: string
  pos: [number, number, number]
  feed: number
  spindle: number
  spindleMode: string
  preambleLines: number // synthetic lines before the file tail (for highlight mapping)
}

/** Does the program actually command the A (rotary) axis? Strips comments so a
 *  header like "(A axis fixture)" doesn't count; matches an A word (an A not
 *  preceded by another letter). Used to decide whether rotary visualization
 *  applies to the loaded program — so a leftover rotary stock can't wrap a flat
 *  XY program (and vice-versa). */
export function usesRotary(gcode: string): boolean {
  return gcode.split(/\r?\n/).some((line) => {
    const s = line.replace(/\(.*?\)/g, '').replace(/;.*/, '')
    return /(?:^|[^a-z])a[-+]?[.\d]/i.test(s)
  })
}

export function buildResume(gcode: string, targetIdx: number, safeZ: number): ResumePlan {
  const lines = gcode.split(/\r?\n/)
  let abs = true
  let mm = true
  let feed = 0
  let spindle = 0
  let spindleMode = ''
  let coolant = ''
  const pos: [number, number, number] = [0, 0, 0]

  for (let i = 0; i < targetIdx && i < lines.length; i++) {
    const line = stripComment(lines[i]).trim()
    if (!line) continue
    const words = line.toUpperCase().match(/[A-Z][-+0-9.]*/g)
    if (!words) continue
    const w: Record<string, number> = {}
    for (const tok of words) {
      const letter = tok[0]
      const val = parseFloat(tok.slice(1))
      if (letter === 'G') {
        if (val === 90) abs = true
        else if (val === 91) abs = false
        else if (val === 20) mm = false
        else if (val === 21) mm = true
      } else if (letter === 'M') {
        if (val === 3) spindleMode = 'M3'
        else if (val === 4) spindleMode = 'M4'
        else if (val === 5) spindleMode = ''
        else if (val === 7 || val === 8) coolant = val === 7 ? 'M7' : 'M8'
        else if (val === 9) coolant = ''
      } else if (!Number.isNaN(val)) {
        w[letter] = val
      }
    }
    if (w.F !== undefined) feed = w.F
    if (w.S !== undefined) spindle = w.S
    const scale = mm ? 1 : 25.4
    if (w.X !== undefined) pos[0] = abs ? w.X * scale : pos[0] + w.X * scale
    if (w.Y !== undefined) pos[1] = abs ? w.Y * scale : pos[1] + w.Y * scale
    if (w.Z !== undefined) pos[2] = abs ? w.Z * scale : pos[2] + w.Z * scale
  }

  const inv = mm ? 1 : 1 / 25.4 // back to program units for emitting
  const f = (n: number): string => Number((n * inv).toFixed(4)).toString()
  const pre: string[] = [mm ? 'G21' : 'G20', 'G90']
  if (spindleMode) pre.push(`${spindleMode} S${spindle || 0}`)
  if (coolant) pre.push(coolant)
  pre.push(`G0 Z${Number(safeZ.toFixed(4))}`) // lift to safe height first
  pre.push(`G0 X${f(pos[0])} Y${f(pos[1])}`) // rapid to resume XY
  pre.push(`G1 Z${f(pos[2])} F${feed || 300}`) // plunge to resume Z
  if (!abs) pre.push('G91') // restore incremental for the streamed remainder

  const rest = lines.slice(targetIdx).join('\n')
  return { gcode: pre.join('\n') + '\n' + rest, pos, feed, spindle, spindleMode, preambleLines: pre.length }
}

/** Per-line motion segments (chord a→b) with the source file line index, used to
 *  map the live tool position back to the G-code line being executed. */
export interface LineSeg {
  idx: number
  a: [number, number, number]
  b: [number, number, number]
}

export function buildLineSegments(gcode: string, opts: WcoOpts = {}): LineSeg[] {
  let abs = true
  let mm = true
  let motion = 0
  let a = 0 // modal A (degrees) — for rotary "unrolled" length
  const offsets = opts.offsets ?? {}
  const rot = opts.rotary
  // rotary tracking runs in an UNROLLED space [along, A-arc, Z] where A degrees are
  // turned into surface arc-length (A·radius), so a pure-A move has real length and
  // the highlight/progress cursor advances through it (flat XYZ length would be 0).
  const K = rot ? (Math.PI / 180) * rot.radius : 0
  const roll = (x: number, y: number, z: number, ad: number): [number, number, number] =>
    rot!.axis === 'X' ? [x, ad * K, z] : [y, ad * K, z]
  let wco = offsets[opts.wcs ?? 'G54'] ?? [0, 0, 0]
  const pos: [number, number, number] = [0, 0, 0]
  const segs: LineSeg[] = []

  gcode.split(/\r?\n/).forEach((raw, i) => {
    const line = stripComment(raw).trim()
    if (!line) return
    const words = line.toUpperCase().match(/[A-Z][-+0-9.]*/g)
    if (!words) return
    const w: Record<string, number> = {}
    for (const tok of words) {
      const letter = tok[0]
      const val = parseFloat(tok.slice(1))
      if (letter === 'G') {
        if (val === 90) abs = true
        else if (val === 91) abs = false
        else if (val === 20) mm = false
        else if (val === 21) mm = true
        else if (val === 0 || val === 1 || val === 2 || val === 3) motion = val
        else if (Number.isInteger(val) && val >= 54 && val <= 59) wco = offsets['G' + val] ?? [0, 0, 0]
      } else if (!Number.isNaN(val)) {
        w[letter] = val
      }
    }
    const scale = mm ? 1 : 25.4
    const tx = w.X !== undefined ? (abs ? w.X * scale + wco[0] : pos[0] + w.X * scale) : pos[0]
    const ty = w.Y !== undefined ? (abs ? w.Y * scale + wco[1] : pos[1] + w.Y * scale) : pos[1]
    const tz = w.Z !== undefined ? (abs ? w.Z * scale + wco[2] : pos[2] + w.Z * scale) : pos[2]
    const aNew = w.A !== undefined ? (abs ? w.A : a + w.A) : a

    // rotary: one unrolled chord per move (incl. pure-A); arcs treated as lines
    if (rot) {
      if (w.X !== undefined || w.Y !== undefined || w.Z !== undefined || w.A !== undefined) {
        segs.push({ idx: i, a: roll(pos[0], pos[1], pos[2], a), b: roll(tx, ty, tz, aNew) })
        pos[0] = tx
        pos[1] = ty
        pos[2] = tz
      }
      a = aNew
      return
    }

    const isArc =
      (motion === 2 || motion === 3) &&
      (w.I !== undefined || w.J !== undefined || w.R !== undefined)

    if (isArc) {
      // interpolate the arc into sub-segments, all tagged with this line index,
      // so the tool tracing the curve stays matched to the correct line
      const cw = motion === 2
      let cx: number
      let cy: number
      if (w.I !== undefined || w.J !== undefined) {
        cx = pos[0] + (w.I ?? 0) * scale
        cy = pos[1] + (w.J ?? 0) * scale
      } else {
        const r = (w.R as number) * scale
        const mx = (pos[0] + tx) / 2
        const my = (pos[1] + ty) / 2
        const dx = tx - pos[0]
        const dy = ty - pos[1]
        const d = Math.hypot(dx, dy) || 1e-6
        const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2))
        const sign = cw ? -1 : 1
        cx = mx + sign * h * (-dy / d)
        cy = my + sign * h * (dx / d)
      }
      const a0 = Math.atan2(pos[1] - cy, pos[0] - cx)
      let a1 = Math.atan2(ty - cy, tx - cx)
      if (cw && a1 >= a0) a1 -= 2 * Math.PI
      if (!cw && a1 <= a0) a1 += 2 * Math.PI
      const rad = Math.hypot(pos[0] - cx, pos[1] - cy)
      const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 64))
      let px = pos[0]
      let py = pos[1]
      let pz = pos[2]
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const ang = a0 + (a1 - a0) * t
        const nx = cx + rad * Math.cos(ang)
        const ny = cy + rad * Math.sin(ang)
        const nz = pos[2] + (tz - pos[2]) * t
        segs.push({ idx: i, a: [px, py, pz], b: [nx, ny, nz] })
        px = nx
        py = ny
        pz = nz
      }
      pos[0] = tx
      pos[1] = ty
      pos[2] = tz
    } else if (w.X !== undefined || w.Y !== undefined || w.Z !== undefined) {
      segs.push({ idx: i, a: [pos[0], pos[1], pos[2]], b: [tx, ty, tz] })
      pos[0] = tx
      pos[1] = ty
      pos[2] = tz
    }
  })
  return segs
}
