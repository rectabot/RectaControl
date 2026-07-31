/**
 * Probe orchestration for the full Probe panel (edge / corner / centre).
 *
 * Two-stage probing (like ioSender): a fast SEARCH approach finds the surface,
 * we back off by `latchDistance`, then a slow LATCH re-probe gives the accurate
 * trigger. grblHAL reports `[PRB:x,y,z:ok]` (machine coords) after each G38.2, so
 * multi-point routines (corner, centre) read those to compute a result.
 *
 * SAFETY: every routine assumes the operator has jogged the tool to the start
 * position shown by the green dot in the diagram, at a safe depth. Probing is
 * Idle-only and gated behind the panel's verification. G38.2 alarms on no-contact
 * (caught → reported). Lateral returns use G53 (machine coords) so they're exact.
 */
import { useStore, type ProbeParams } from './store'

export type ProbeAction =
  | { kind: 'wcs'; wcs: string } // set G54..G59 zero
  | { kind: 'g92' } // set a temporary G92 offset
  | { kind: 'measure' } // just report, don't set anything

type Axis = 'X' | 'Y' | 'Z'
type Dir = 1 | -1

interface Prb {
  x: number
  y: number
  z: number
  ok: boolean
}

export interface ProbeResult {
  ok: boolean
  error?: string
  /** human-readable measurement (for the Measure action / feedback) */
  note?: string
  /** measured skew angle in degrees (rotation mode only) */
  angle?: number
}

// grblHAL reports one coordinate PER AXIS, so a 4-axis board (XYZA) emits
// `[PRB:x,y,z,a:1]` — FOUR numbers, not three. Match the whole comma list and
// split it, so 3/4/5-axis machines all parse (a rigid 3-number regex left the
// 4-axis probe hanging: it triggered but the result line was never recognised).
const PRB_RE = /\[PRB:([-0-9.,]+):([01])\]/
const WCS_P: Record<string, number> = { G54: 1, G55: 2, G56: 3, G57: 4, G58: 5, G59: 6 }
const AX = (p: Prb, a: Axis): number => (a === 'X' ? p.x : a === 'Y' ? p.y : p.z)

const send = (line: string): void => void window.recta.send(line)
const rel = (axis: Axis, d: number): void => {
  send('G91')
  send(`G0 ${axis}${d.toFixed(3)}`)
  send('G90')
}
const gotoMachine = (axis: Axis, v: number): void => send(`G53 G0 ${axis}${v.toFixed(3)}`)

/** Fire one G38.2 in an axis/direction; resolve with the machine position at
 *  trigger, or reject on no-contact / timeout. */
function probeStep(axis: Axis, dir: Dir, distance: number, feed: number): Promise<Prb> {
  return new Promise((resolve, reject) => {
    let settled = false
    const off = window.recta.onEvent((e) => {
      if (e.type !== 'line') return
      const m = PRB_RE.exec(e.data)
      if (!m) return
      settled = true
      off()
      clearTimeout(timer)
      const n = m[1].split(',').map(Number) // [x, y, z, (a, …)]
      const p: Prb = { x: n[0], y: n[1], z: n[2], ok: m[2] === '1' }
      p.ok ? resolve(p) : reject(new Error(`${axis}${dir > 0 ? '+' : '-'} no contact`))
    })
    const timer = setTimeout(() => {
      if (!settled) {
        off()
        reject(new Error('probe timeout'))
      }
    }, 60000)
    send('G91')
    send(`G38.2 ${axis}${(dir * distance).toFixed(3)} F${feed}`)
    send('G90')
  })
}

/** Two-stage probe: search fast, back off, latch slow. Returns the latch trigger. */
async function probeAxis(axis: Axis, dir: Dir, p: ProbeParams): Promise<Prb> {
  await probeStep(axis, dir, p.probeDistance, p.searchFeed)
  rel(axis, -dir * p.latchDistance) // back off the surface
  return probeStep(axis, dir, p.latchDistance * 2, p.latchFeed)
}

/** Apply the chosen action to one axis at the CURRENT position (tool is at the
 *  trigger). `value` = the work coordinate the current position should read. */
function apply(axis: Axis, value: number, action: ProbeAction): void {
  if (action.kind === 'measure') return
  if (action.kind === 'g92') send(`G92 ${axis}${value.toFixed(4)}`)
  else send(`G10 L20 P${WCS_P[action.wcs] ?? 0} ${axis}${value.toFixed(4)}`)
}

const fmt = (n: number): string => Number(n.toFixed(3)).toString()
const startPos = (): number[] | null => useStore.getState().status?.mpos ?? null

// ── modes ────────────────────────────────────────────────────────────────────

/** Tool-height Z touch-off (two-stage). Surface reads `thickness` (touch plate). */
export async function runZ(p: ProbeParams, action: ProbeAction): Promise<ProbeResult> {
  try {
    await probeAxis('Z', -1, p)
    apply('Z', p.thickness, action)
    rel('Z', p.retract)
    return { ok: true, note: `Z ✓` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** The sideways plate offsets, one per axis.
 *
 *  Two numbers, never one, even on a plate meant to be symmetric. These plates get
 *  MADE, and they come off the machine at whatever they came off at — 10 on one
 *  rail and 9.5 on the other is a normal outcome. One shared value would put that
 *  half millimetre straight into the corner zero with nothing to show for it.
 *
 *  Which physical rail is `x` and which is `y` follows from how the plate is
 *  turned, and that follows from the corner. This maps the way the drawing in
 *  Settings is labelled, which is the FRONT-LEFT corner — the only corner the full
 *  three-axis zero offers, and the one the CAM origin uses. */
export interface Plate {
  x: number
  y: number
}
const NO_PLATE: Plate = { x: 0, y: 0 }

/** Single edge on one axis; that axis zero lands on the material edge. `plate` is
 *  the sideways touch-plate thickness FOR THAT AXIS (0 for a direct conductive
 *  touch); the edge sits tipRadius + plate beyond the contact. */
export async function runEdge(axis: Axis, dir: Dir, p: ProbeParams, action: ProbeAction, plate = 0): Promise<ProbeResult> {
  try {
    const off = p.tipDiameter / 2 + plate
    const latch = await probeAxis(axis, dir, p)
    apply(axis, -dir * off, action)
    rel(axis, -dir * p.retract)
    return { ok: true, note: `${axis}: ${fmt(AX(latch, axis))}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Outside/inside corner = two edge finds (X then Y) from a diagonal start, with a
 *  clearance move between so the tool clears the first face. Sets both axes. */
export async function runCorner(
  xDir: Dir,
  yDir: Dir,
  p: ProbeParams,
  action: ProbeAction,
  plate: Plate = NO_PLATE
): Promise<ProbeResult> {
  try {
    const lx = await probeAxis('X', xDir, p)
    apply('X', -xDir * (p.tipDiameter / 2 + plate.x), action)
    rel('X', -xDir * p.xyClearance) // clear the X face before probing Y
    const ly = await probeAxis('Y', yDir, p)
    apply('Y', -yDir * (p.tipDiameter / 2 + plate.y), action)
    rel('Y', -yDir * p.retract)
    return { ok: true, note: `X ${fmt(AX(lx, 'X'))} · Y ${fmt(AX(ly, 'Y'))}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * External corner, all three axes, from ONE start position ~10–15 mm inside the
 * corner over the top surface:
 *   1) probe Z down → surface zero,
 *   2) lift, move OUT past the X face (`approach`), drop `depth` below the surface,
 *      probe the X face → X zero,
 *   3) return over the material, do the same for the Y face → Y zero.
 * Result: the corner is the work X0 Y0 Z0. Needs the workpiece parked far enough
 * (> approach) into positive machine space so there's room to move around it.
 * `plate` = sideways touch-plate thickness for the X/Y faces (0 = direct touch).
 */
export async function runCornerExternal3(
  xDir: Dir,
  yDir: Dir,
  p: ProbeParams,
  action: ProbeAction,
  plate: Plate = NO_PLATE,
  onStep?: (s: string) => void
): Promise<ProbeResult> {
  const s = startPos()
  if (!s) return { ok: false, error: 'no-pos' }
  const [sx, sy] = s
  const offX = p.tipDiameter / 2 + plate.x
  const offY = p.tipDiameter / 2 + plate.y
  // relative Z moves (referenced to the surface contact) so the routine doesn't
  // depend on Z0 being set — works for Measure too, and is robust across WCS.
  const lift = p.retract // clear above the surface to move laterally
  const drop = p.retract + p.depth // from +retract above surface to `depth` below
  try {
    onStep?.('Z')
    await probeAxis('Z', -1, p) // probe the top surface (tool ends on the surface)
    apply('Z', p.thickness, action)
    rel('Z', lift) // up, clear of the top

    onStep?.('X')
    rel('X', -xDir * p.approach) // move out past the X face
    rel('Z', -drop) // drop beside the face
    const lx = await probeAxis('X', xDir, p)
    apply('X', -xDir * offX, action)
    rel('Z', drop) // back up
    gotoMachine('X', sx) // back over the material in X

    onStep?.('Y')
    rel('Y', -yDir * p.approach)
    rel('Z', -drop)
    const ly = await probeAxis('Y', yDir, p)
    apply('Y', -yDir * offY, action)
    rel('Z', drop)
    gotoMachine('Y', sy)

    onStep?.('done')
    return { ok: true, note: `X ${fmt(AX(lx, 'X'))} · Y ${fmt(AX(ly, 'Y'))} · Z ✓` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Workpiece rotation / squareness: probe ONE edge at TWO points `spacing` apart and
 * report the skew angle of that edge versus the machine axis. From a start beside the
 * edge (green dot), it probes point 1, backs off, moves `spacing` ALONG the edge,
 * probes point 2, then returns. angle = atan2(Δperp, spacing).
 *
 * `probeAx` = the axis pushed toward the edge (X for a left/right edge, Y for a
 * front/back edge); the edge itself runs along the OTHER axis, which is where we
 * step `spacing`. The touch-plate/tip offset cancels out (both points share it), so
 * the angle is independent of tool radius. This only MEASURES — grblHAL has no
 * coordinate rotation, so use the number to physically re-square the part (tap it).
 */
export async function runRotation(
  probeAx: Axis,
  dir: Dir,
  spacing: number,
  p: ProbeParams,
  onStep?: (s: string) => void
): Promise<ProbeResult> {
  const s = startPos()
  if (!s) return { ok: false, error: 'no-pos' }
  const edgeAxis: Axis = probeAx === 'X' ? 'Y' : 'X'
  const startAlong = probeAx === 'X' ? s[1] : s[0] // machine coord of edgeAxis at start
  try {
    onStep?.('1')
    const a = await probeAxis(probeAx, dir, p)
    rel(probeAx, -dir * p.retract) // back off the edge
    onStep?.('2')
    rel(edgeAxis, spacing) // step along the edge
    const b = await probeAxis(probeAx, dir, p)
    rel(probeAx, -dir * p.retract)
    gotoMachine(edgeAxis, startAlong) // slide back to the start along the edge
    onStep?.('done')
    const delta = AX(b, probeAx) - AX(a, probeAx)
    const deg = (Math.atan2(delta, spacing) * 180) / Math.PI
    return { ok: true, angle: deg, note: `∠ ${deg.toFixed(3)}°  ·  Δ ${fmt(delta)} / ${spacing} mm` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Hole centre (internal): from a roughly-centred start inside the bore, probe
 *  ±X/±Y outward, set the work X0Y0 to the true centre. Z never changes. */
export async function runHoleCenter(
  p: ProbeParams,
  action: ProbeAction,
  onStep?: (s: string) => void
): Promise<ProbeResult> {
  const s = startPos()
  if (!s) return { ok: false, error: 'no-pos' }
  const [sx, sy] = s
  try {
    onStep?.('X+')
    const xp = await probeAxis('X', 1, p)
    gotoMachine('X', sx)
    onStep?.('X-')
    const xm = await probeAxis('X', -1, p)
    const cx = (xp.x + xm.x) / 2
    gotoMachine('X', cx)

    onStep?.('Y+')
    const yp = await probeAxis('Y', 1, p)
    gotoMachine('Y', sy)
    onStep?.('Y-')
    const ym = await probeAxis('Y', -1, p)
    const cy = (yp.y + ym.y) / 2
    gotoMachine('Y', cy)

    onStep?.('zero')
    apply('X', 0, action)
    apply('Y', 0, action)
    return { ok: true, note: `⊙ X ${fmt(cx)} · Y ${fmt(cy)}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Boss centre (external): from a start above the boss centre near its top, go
 *  around each of the 4 sides (over → down `depth` → probe inward → up → back) and
 *  set X0Y0 to the centre. Needs approximate boss X/Y size to reach past each face. */
export async function runBossCenter(
  p: ProbeParams,
  action: ProbeAction,
  sizeX: number,
  sizeY: number,
  onStep?: (s: string) => void
): Promise<ProbeResult> {
  const s = startPos()
  if (!s) return { ok: false, error: 'no-pos' }
  const [sx, sy] = s
  const outX = sizeX / 2 + p.xyClearance
  const outY = sizeY / 2 + p.xyClearance

  /** approach one face from `dir` side of `axis`, probe inward, return the face
   *  machine coordinate. Tool lifts over the boss, drops beside it, probes, lifts. */
  const side = async (axis: Axis, dir: Dir, out: number, homeVal: number): Promise<number> => {
    gotoMachine(axis, homeVal + dir * out) // move out beyond the face (at safe Z)
    rel('Z', -p.depth) // drop beside the boss
    const latch = await probeAxis(axis, -dir as Dir, p) // probe inward toward the boss
    rel(axis, dir * p.xyClearance) // pull away from the face
    rel('Z', p.depth) // lift back to safe Z
    gotoMachine(axis, homeVal) // recentre this axis
    return AX(latch, axis)
  }

  try {
    onStep?.('X+')
    const xPlus = await side('X', 1, outX, sx)
    onStep?.('X-')
    const xMinus = await side('X', -1, outX, sx)
    const cx = (xPlus + xMinus) / 2
    gotoMachine('X', cx)

    onStep?.('Y+')
    const yPlus = await side('Y', 1, outY, sy)
    onStep?.('Y-')
    const yMinus = await side('Y', -1, outY, sy)
    const cy = (yPlus + yMinus) / 2
    gotoMachine('Y', cy)

    onStep?.('zero')
    apply('X', 0, action)
    apply('Y', 0, action)
    return { ok: true, note: `⊙ X ${fmt(cx)} · Y ${fmt(cy)}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
