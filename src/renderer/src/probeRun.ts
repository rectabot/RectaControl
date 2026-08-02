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

/* There is no longer a choice of what to do with the measurement, and that is the
 * point. It used to offer three: set the work zero, apply a G92 offset, or measure
 * and change nothing.
 *
 * Measure was the one Filip named — a button that looks like an action, does nothing
 * visible, and lets somebody walk away believing their zero is set. They find out
 * when the tool goes into the table.
 *
 * G92 was worse. It does not replace the zero, it stacks ON TOP of the active
 * coordinate system: the DRO still says G54 with nothing to show an offset exists, a
 * soft reset wipes it — mid-job, that means the rest of the program runs against the
 * old numbers — and applying it twice compounds it.
 *
 * And "which coordinate system" is not this dialog's question either. The DRO
 * already selects G54–G59 and that selection IS the machine's active system; a
 * second selector here is two places meaning one thing, with no way to tell which
 * wins. None of ioSender, gSender or ESTLcam offers any of this: you probe, and the
 * zero is set. So: probing sets the work zero in the active WCS. One meaning.
 */

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
  /** human-readable measurement, for the result line */
  note?: string
  /** measured skew angle in degrees (rotation mode only) */
  angle?: number
}

// grblHAL reports one coordinate PER AXIS, so a 4-axis board (XYZA) emits
// `[PRB:x,y,z,a:1]` — FOUR numbers, not three. Match the whole comma list and
// split it, so 3/4/5-axis machines all parse (a rigid 3-number regex left the
// 4-axis probe hanging: it triggered but the result line was never recognised).
const PRB_RE = /\[PRB:([-0-9.,]+):([01])\]/

const AX = (p: Prb, a: Axis): number => (a === 'X' ? p.x : a === 'Y' ? p.y : p.z)

const send = (line: string): void => void window.recta.send(line)
const rel = (axis: Axis, d: number): void => {
  send('G91')
  send(`G0 ${axis}${d.toFixed(3)}`)
  send('G90')
}
const gotoMachine = (axis: Axis, v: number): void => send(`G53 G0 ${axis}${v.toFixed(3)}`)

/** Fire one G38.2 in an axis/direction; resolve with the machine position at
 *  trigger, or reject on no-contact / an alarm / the board going away.
 *
 *  The alarm and disconnect cases are not tidiness. `[PRB:]` is the only thing this
 *  used to wait for, and an E-stop halfway through a cycle means that line is never
 *  coming — so the routine sat for the full minute before reporting "probe timeout",
 *  which is both the wrong reason and a minute of an operator watching a stopped
 *  machine and wondering whether something is still about to move. */
function probeStep(axis: Axis, dir: Dir, distance: number, feed: number): Promise<Prb> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      off()
      clearTimeout(timer)
      clearInterval(watch)
      fn()
    }
    const off = window.recta.onEvent((e) => {
      if (e.type !== 'line') return
      const m = PRB_RE.exec(e.data)
      if (!m) return
      const n = m[1].split(',').map(Number) // [x, y, z, (a, …)]
      const p: Prb = { x: n[0], y: n[1], z: n[2], ok: m[2] === '1' }
      finish(() => (p.ok ? resolve(p) : reject(new Error(`${axis}${dir > 0 ? '+' : '-'} no contact`))))
    })
    // The board's own state, not a line: an alarm arrives as a state change and may
    // carry no line we would recognise, and a dropped link produces nothing at all.
    const watch = setInterval(() => {
      const s = useStore.getState()
      if (!s.connected) finish(() => reject(new Error('connection lost')))
      else if ((s.status?.state ?? '').split(':')[0] === 'Alarm')
        finish(() => reject(new Error('machine alarmed')))
    }, 200)
    const timer = setTimeout(() => finish(() => reject(new Error('probe timeout'))), 60000)
    send('G91')
    send(`G38.2 ${axis}${(dir * distance).toFixed(3)} F${feed}`)
    send('G90')
  })
}

/** Wait until the machine has actually stopped moving.
 *
 *  Every positioning move in this file is fire-and-forget: `rel()` and `gotoMachine()`
 *  hand grblHAL a line and return. The board queues them and runs them in order, which
 *  is right for motion — but it means the app is a whole planner ahead of the machine,
 *  and ANY question asked about machine state in between is answered about the past.
 *
 *  That is not theory. On 2 Aug 2026 the three-axis corner set its Z zero, queued a
 *  lift, a 22 mm move out and an 11 mm drop — all three sent inside one millisecond —
 *  and then asked whether the probe was touching. The last status report still showed
 *  the tool sitting on the plate from the Z latch, so the check refused a cycle that
 *  was perfectly fine, and the X probe never went out.
 *
 *  The initial pause is deliberate: a status report from before the moves were even
 *  started would otherwise read `Idle` and satisfy this instantly. */
async function settle(maxMs = 30000): Promise<void> {
  const start = Date.now()
  await new Promise((r) => setTimeout(r, 400)) // longer than a poll period
  while (Date.now() - start < maxMs) {
    const s = useStore.getState()
    if (!s.connected) throw new Error('connection lost')
    const base = (s.status?.state ?? '').split(':')[0]
    if (base === 'Alarm') throw new Error('machine alarmed')
    if (base === 'Idle') return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('machine did not stop')
}

/** Two-stage probe: search fast, back off, latch slow. Returns the latch trigger.
 *
 *  Refuses to start against a probe that is already touching — but only once the
 *  machine has settled, so the reading describes now rather than one planner ago.
 *  grblHAL answers this case with ALARM:4 ("probe not in expected initial state"),
 *  which is correct, unreadable and latched, so a harmless mistake costs a reset. The
 *  usual causes are worth naming rather than coding around: the tool is resting on the
 *  plate, or the wire is shorted, or `$6` inverts the probe input the wrong way and the
 *  board believes it is touching all the time. */
async function probeAxis(axis: Axis, dir: Dir, p: ProbeParams): Promise<Prb> {
  await settle()
  if ((useStore.getState().status?.pins ?? '').includes('P')) throw new Error('probe already touching')
  await probeStep(axis, dir, p.probeDistance, p.searchFeed)
  rel(axis, -dir * p.latchDistance) // back off the surface
  return probeStep(axis, dir, p.latchDistance * 2, p.latchFeed)
}

/** Set the work zero for one axis at the CURRENT position (tool is at the trigger).
 *  `value` = the work coordinate this position should read.
 *
 *  `P0` is grblHAL's "whatever coordinate system is active", so this follows the DRO
 *  rather than carrying its own idea of which system to write. */
function apply(axis: Axis, value: number): void {
  send(`G10 L20 P0 ${axis}${value.toFixed(4)}`)
}

const fmt = (n: number): string => Number(n.toFixed(3)).toString()
const startPos = (): number[] | null => useStore.getState().status?.mpos ?? null

// ── modes ────────────────────────────────────────────────────────────────────

/** Tool-height Z touch-off (two-stage). Surface reads `thickness` (touch plate). */
export async function runZ(p: ProbeParams): Promise<ProbeResult> {
  try {
    await probeAxis('Z', -1, p)
    apply('Z', p.thickness)
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
export async function runEdge(axis: Axis, dir: Dir, p: ProbeParams, plate = 0): Promise<ProbeResult> {
  try {
    const off = p.tipDiameter / 2 + plate
    const latch = await probeAxis(axis, dir, p)
    apply(axis, -dir * off)
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
  plate: Plate = NO_PLATE
): Promise<ProbeResult> {
  try {
    const lx = await probeAxis('X', xDir, p)
    apply('X', -xDir * (p.tipDiameter / 2 + plate.x))
    rel('X', -xDir * p.xyClearance) // clear the X face before probing Y
    const ly = await probeAxis('Y', yDir, p)
    apply('Y', -yDir * (p.tipDiameter / 2 + plate.y))
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
/** The corner itself, shared by the plain three-axis zero and the skew measurement.
 *
 *  Kept as one routine on purpose: the skew cycle begins with exactly these three
 *  probes — Filip's words, "first it measures the corner by height, then from that
 *  zero it knows to drop 5 mm and touch X, then it moves to Y and touches there, and
 *  then we have the corner point" — and two copies of a sequence that drives a tool
 *  around a workpiece is two places for a clearance to go wrong.
 *
 *  Returns the two side contacts in machine coordinates and the start position, which
 *  is what a caller needs to go and probe somewhere else along the same edge. */
async function cornerXYZ(
  xDir: Dir,
  yDir: Dir,
  p: ProbeParams,
  plate: Plate,
  onStep?: (s: string) => void
): Promise<{ lx: Prb; ly: Prb; sx: number; sy: number; drop: number }> {
  const s = startPos()
  if (!s) throw new Error('no-pos')
  const [sx, sy] = s
  const offX = p.tipDiameter / 2 + plate.x
  const offY = p.tipDiameter / 2 + plate.y
  // relative Z moves (referenced to the surface contact) so the routine doesn't
  // depend on Z0 being set, and is robust across WCS.
  const lift = p.retract // clear above the surface to move laterally
  const drop = p.retract + p.depth // from +retract above surface to `depth` below

  onStep?.('Z')
  await probeAxis('Z', -1, p) // probe the top surface (tool ends on the surface)
  apply('Z', p.thickness)
  rel('Z', lift) // up, clear of the top

  onStep?.('X')
  rel('X', -xDir * p.approach) // move out past the X face
  rel('Z', -drop) // drop beside the face
  const lx = await probeAxis('X', xDir, p)
  apply('X', -xDir * offX)
  rel('Z', drop) // back up
  gotoMachine('X', sx) // back over the material in X

  onStep?.('Y')
  rel('Y', -yDir * p.approach)
  rel('Z', -drop)
  const ly = await probeAxis('Y', yDir, p)
  apply('Y', -yDir * offY)
  rel('Z', drop)
  gotoMachine('Y', sy)

  return { lx, ly, sx, sy, drop }
}

export async function runCornerExternal3(
  xDir: Dir,
  yDir: Dir,
  p: ProbeParams,
  plate: Plate = NO_PLATE,
  onStep?: (s: string) => void
): Promise<ProbeResult> {
  try {
    const { lx, ly } = await cornerXYZ(xDir, yDir, p, plate, onStep)
    onStep?.('done')
    return { ok: true, note: `X ${fmt(AX(lx, 'X'))} · Y ${fmt(AX(ly, 'Y'))} · Z ✓` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * How far the workpiece is turned, measured from the corner it is zeroed on.
 *
 * Filip's sequence, and the order matters: probe the top first so the sides can be
 * touched a known depth below it, probe X to find the corner, probe Y to complete
 * it — that is the corner point and the work zero — then step `spacing` along the
 * front edge and touch Y a second time. Two Y contacts a known distance apart give
 * the angle: atan(ΔY / spacing).
 *
 * The angle therefore describes THE EDGE THE Y PROBE TOUCHES, against the machine's
 * X axis. On stock that is not square in itself, the other edge would answer
 * differently — which is a property of the workpiece, not a fault in the measurement.
 *
 * Both Y contacts are made at the same depth and from the same side, by construction
 * rather than by asking the operator to reproduce it: two points taken at different
 * depths would fold the tilt of the face into a number that claims to be rotation.
 * The tip radius and plate thickness cancel for the same reason — both points carry
 * them equally — so the angle is independent of the tool.
 *
 * Kept separate from the plain corner cycle on Filip's call: skew is wanted only when
 * it is wanted, and it costs an extra traverse and probe every time.
 */
export async function runSkew(
  xDir: Dir,
  yDir: Dir,
  spacing: number,
  p: ProbeParams,
  plate: Plate = NO_PLATE,
  onStep?: (s: string) => void
): Promise<ProbeResult> {
  try {
    const { ly, sx, sy, drop } = await cornerXYZ(xDir, yDir, p, plate, onStep)

    // Step along the front edge and touch it again. `xDir` points from the tool
    // toward the X face, so the material lies the other way — which is where the
    // second point has to be.
    onStep?.('∠')
    const along = -xDir * spacing
    gotoMachine('X', sx + along)
    rel('Y', -yDir * p.approach) // out past the Y face, as before
    rel('Z', -drop) // and down to the same depth as the first touch
    const far = await probeAxis('Y', yDir, p)
    rel('Z', drop)
    gotoMachine('Y', sy)
    gotoMachine('X', sx)

    onStep?.('done')
    const delta = AX(far, 'Y') - AX(ly, 'Y')
    // measured along +X, whichever way the routine actually walked
    const deg = (Math.atan2(delta * -xDir, spacing) * 180) / Math.PI
    return { ok: true, angle: deg, note: `∠ ${deg.toFixed(3)}°  ·  Δ ${fmt(delta)} / ${spacing} mm` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/* Hole centre and boss centre used to live here. Taken out of the app on 31 Jul
 * 2026 — Filip: "I don't know how they work or what their logic is, that is why
 * they are not confirmed" — and a hole cannot be probed with a touch plate anyway,
 * since there is nothing inside it to press against. They will come back when
 * there is a way to test them.
 *
 * The routines are parked in `.private/probeAdvanced.ts.txt` (gitignored, and
 * outside `src/` so tsc does not compile a file nobody imports). They are also in
 * this file's git history, which is the copy that is actually backed up. */
