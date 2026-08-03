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
import { skewCorner } from '@shared/skew'

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
async function probeAxis(axis: Axis, dir: Dir, p: ProbeParams, reach = p.probeDistance): Promise<Prb> {
  await settle()
  if ((useStore.getState().status?.pins ?? '').includes('P')) throw new Error('probe already touching')
  await probeStep(axis, dir, reach, p.searchFeed)
  rel(axis, -dir * p.latchDistance) // back off the surface
  return probeStep(axis, dir, p.latchDistance * 2, p.latchFeed)
}

/**
 * Set the work zero for one axis from the point the probe TRIGGERED at, so that
 * `machine` reads work coordinate `value`.
 *
 * This used to be `G10 L20`, which sets the zero from wherever the tool is standing —
 * and the tool is never standing on the trigger point. The board captures `[PRB:]` in
 * the step interrupt at the instant the probe closes, then stops as fast as it can,
 * which takes a little further travel. Measured on 3 Aug 2026 across a whole corner
 * cycle: 10 µm on X, 13 on Y, 14 on Z, every one of them in the direction the probe was
 * moving. Systematic, not noise — it does not average out over repeats, and it grows
 * with the approach feed. The X/Y zeros therefore sat that far INSIDE the material and
 * Z0 that far BELOW the surface.
 *
 * `[PRB:]` is the trigger itself, so building the answer from it leaves the overshoot
 * behind entirely. `G10 L2` takes the machine coordinate of the origin outright.
 *
 * The two subtractions are what `G10 L20` was doing for us. The board computes it as
 * `WCS = MPos - G92 - TLO - WPos` (gcode.c), and `L2` applies no modifiers at all, so
 * a replacement that ignored them would be exact only while both are zero. They are
 * zero on this machine today; TLO stops being zero the moment tool lengths are
 * measured, and that is precisely when a silently wrong Z would be hardest to spot.
 *
 * `P0` is grblHAL's "whatever coordinate system is active", so this still follows the
 * DRO rather than carrying its own idea of which system to write.
 */
function applyAt(axis: Axis, machine: number, value: number): void {
  const s = useStore.getState()
  const i = axis === 'X' ? 0 : axis === 'Y' ? 1 : 2
  const origin = machine - value - (s.g92Offset[i] ?? 0) - (s.toolOffset[i] ?? 0)
  send(`G10 L2 P0 ${axis}${origin.toFixed(4)}`)
}

/**
 * Move the work origin onto the corner the skew cycle works out once it knows the
 * angle, correcting the two zeros its corner probes set along the way.
 *
 * Goes out through `applyAt` like every other zero, which is what keeps the G92/TLO
 * subtraction in ONE place. The first version of this wrote its `G10 L2` directly and
 * so quietly ignored both modifiers — right on a machine where they are zero, wrong on
 * the first one where they are not, and invisible either way.
 *
 * The geometry is in @shared/skew, away from the store, so it can be checked against
 * the numbers the machine really produced.
 */
function setSkewCorner(xDir: Dir, yDir: Dir, deg: number, lx: Prb, ly: Prb, p: ProbeParams, plate: Plate): void {
  const c = skewCorner({
    deg,
    left: { x: lx.x, y: lx.y },
    front: { x: ly.x, y: ly.y },
    standoffX: p.tipDiameter / 2 + plate.x,
    standoffY: p.tipDiameter / 2 + plate.y,
    xDir,
    yDir
  })
  // the corner IS the origin, so each axis reads work 0 there
  applyAt('X', c.x, 0)
  applyAt('Y', c.y, 0)
}

const fmt = (n: number): string => Number(n.toFixed(3)).toString()
/**
 * Where the cycle begins, in machine coordinates — the spot it will come home to.
 *
 * Settles FIRST, and that is the whole point of this function existing rather than
 * reading the store inline. The status report is a snapshot of whenever the last poll
 * happened; asked while anything is still moving it answers about the past. `settle()`
 * waits for `Idle`, so the report it leaves behind describes a machine that has
 * stopped — which is the only kind of report a "return here afterwards" may be built on.
 *
 * Filip found it on 3 Aug 2026, running the same cycle twice in a row. The first came
 * home to X-8.623 and the second to X-23.691, from identical motion. -23.691 was not a
 * start position at all: it was where the machine had come to rest after the PREVIOUS
 * cycle's probe, six microns past its trigger. So the second cycle "returned" to the
 * face it had just measured, and stayed pressed against it — and the cycle after that
 * would have begun from there, carrying the mistake forward.
 *
 * Same trap as the touch check on 2 Aug and the same cure, one step earlier in the
 * routine: `settle()` guarded the probing, and this ran in front of it, unguarded.
 */
async function startPos(): Promise<number[] | null> {
  await settle()
  return useStore.getState().status?.mpos ?? null
}

// ── modes ────────────────────────────────────────────────────────────────────

/** Tool-height Z touch-off (two-stage). Surface reads `thickness` (touch plate). */
export async function runZ(p: ProbeParams): Promise<ProbeResult> {
  try {
    const latch = await probeAxis('Z', -1, p)
    applyAt('Z', latch.z, p.thickness)
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
    applyAt(axis, AX(latch, axis), -dir * off)
    rel(axis, -dir * p.retract)
    return { ok: true, note: `${axis}: ${fmt(AX(latch, axis))}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Every cycle that starts ABOVE the top face, from ONE position ~10–15 mm inside the
 * corner:
 *   1) probe Z down → the top surface,
 *   2) lift, move OUT past a side face (`approach`), drop `depth` below the surface,
 *      probe that face → its zero, come back up and over the material,
 *   3) repeat for the other face, if it was asked for.
 * Needs the workpiece parked far enough (> approach) into positive machine space so
 * there's room to move around it. `plate` = sideways touch-plate thickness for the
 * X/Y faces (0 = direct touch).
 *
 * The top contact is what makes the rest possible, and that is why every one of these
 * begins with it: each drop is measured DOWN FROM THE SURFACE THE TOOL JUST TOUCHED,
 * so the routine needs to know nothing about the workpiece beforehand. It is also why
 * a side face on its own is a different cycle (`runEdge`) — there the operator has put
 * the tool at depth, and taken that responsibility.
 *
 * Shared by the corner zeros and the skew measurement, on purpose: the skew cycle
 * begins with exactly these probes — Filip's words, "first it measures the corner by
 * height, then from that zero it knows to drop 5 mm and touch X, then it moves to Y
 * and touches there, and then we have the corner point" — and two copies of a
 * sequence that drives a tool around a workpiece is two places for a clearance to go
 * wrong.
 *
 * Returns the side contacts in machine coordinates and the start position, which is
 * what a caller needs to go and probe somewhere else along the same edge.
 */
async function fromTop(
  xDir: Dir,
  yDir: Dir,
  p: ProbeParams,
  plate: Plate,
  /** Which side faces to visit, in order. One entry for a single-face zero, both for
   *  a corner. The order IS the order the tool walks them. */
  sides: Axis[],
  onStep?: (s: string) => void,
  /** Leave the tool where the LAST probe stopped — beside the face, at depth —
   *  instead of lifting and coming home. For a caller that has another point to touch
   *  on that same face, going back over the material only to come out again is a trip
   *  out and in for nothing. */
  hold = false,
  /** Whether the top contact becomes the Z zero.
   *
   *  The top is touched either way; see above for why. This decides only whether the
   *  number is written down — off is for somebody whose Z is already set from another
   *  reference and must not lose it. */
  zeroZ = true
): Promise<{ hit: Partial<Record<Axis, Prb>>; sx: number; sy: number; drop: number }> {
  const s = await startPos()
  if (!s) throw new Error('no-pos')
  const [sx, sy] = s
  const off: Record<string, number> = { X: p.tipDiameter / 2 + plate.x, Y: p.tipDiameter / 2 + plate.y }
  const dirOf: Record<string, Dir> = { X: xDir, Y: yDir }
  const homeOf: Record<string, number> = { X: sx, Y: sy }
  // relative Z moves (referenced to the surface contact) so the routine doesn't
  // depend on Z0 being set, and is robust across WCS.
  const lift = p.retract // clear above the surface to move laterally
  const drop = p.retract + p.depth // from +retract above surface to `depth` below

  onStep?.('Z')
  const top = await probeAxis('Z', -1, p) // probe the top surface (tool ends on the surface)
  if (zeroZ) applyAt('Z', top.z, p.thickness)
  rel('Z', lift) // up, clear of the top

  const hit: Partial<Record<Axis, Prb>> = {}
  for (let i = 0; i < sides.length; i++) {
    const ax = sides[i]
    const dir = dirOf[ax]
    onStep?.(ax)
    rel(ax, -dir * p.approach) // move out past the face
    rel('Z', -drop) // drop beside it
    const latch = (hit[ax] = await probeAxis(ax, dir, p))
    applyAt(ax, AX(latch, ax), -dir * off[ax])
    // Come back up and over the material before the next face — except at the very
    // end when the caller has said it is staying put.
    if (!(hold && i === sides.length - 1)) {
      rel('Z', drop)
      gotoMachine(ax, homeOf[ax])
    }
  }

  return { hit, sx, sy, drop }
}

/** What a from-the-top cycle writes down, in the order it does it. The name is the
 *  order: `zx` touches the top and the left face, and sets Z then X. `xy` is the
 *  corner with the Z left alone. */
export type FromTop = 'zx' | 'zy' | 'zxy' | 'xy'

const SIDES: Record<FromTop, Axis[]> = { zx: ['X'], zy: ['Y'], zxy: ['X', 'Y'], xy: ['X', 'Y'] }

export async function runFromTop(
  xDir: Dir,
  yDir: Dir,
  p: ProbeParams,
  plate: Plate = NO_PLATE,
  onStep?: (s: string) => void,
  what: FromTop = 'zxy'
): Promise<ProbeResult> {
  try {
    const { hit } = await fromTop(xDir, yDir, p, plate, SIDES[what], onStep, false, what !== 'xy')
    onStep?.('done')
    const parts = SIDES[what].map((a) => `${a} ${fmt(AX(hit[a] as Prb, a))}`)
    if (what !== 'xy') parts.unshift('Z ✓')
    return { ok: true, note: parts.join(' · ') }
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
    // `hold`: stay beside the Y face at depth rather than lifting home, because the
    // next point is on that same face. Going back over the material and out again
    // would be a trip in and out for nothing.
    const { hit, sx, sy, drop } = await fromTop(xDir, yDir, p, plate, ['X', 'Y'], onStep, true)
    const ly = hit.Y as Prb

    // Back off the face, slide along it, touch it again — all at the depth the first
    // contact was made at, which is what keeps the two points comparable.
    //
    // The direction is `+xDir`, and getting that backwards is what the first hardware
    // run caught: the corner cycle moves `-xDir * approach` to get OUT past the X
    // face, so the face lies that way and the BODY of the workpiece lies the other —
    // along +xDir. Going the other way walks off the end of the part into open air,
    // and the second Y probe then finds nothing to touch. On a front-left corner that
    // is a confident 50 mm to the left of a workpiece extending to the right.
    onStep?.('∠')
    rel('Y', -yDir * p.approach) // clear of the face, where it stood before probing
    rel('X', xDir * spacing) // along the edge

    // This one probe reaches further than `probeDistance`, and only this one.
    //
    // The tool stands `approach` off the face where it touched it. Fifty millimetres
    // later the face has moved by `spacing · tan(skew)` — away from the tool if the
    // part leans that way — so the reach it needs is the standing-off distance plus
    // that drift. With 22 mm of approach against a 25 mm limit there were three
    // millimetres of headroom, which is 3.4° of skew, and Filip's part was past it:
    // the probe ran out of travel and reported no contact on a part that was there.
    //
    // The first three probes keep the tight limit and should. They approach a face
    // that is where the operator put the tool, and a long search there is a tool
    // travelling into something unknown. This one is the opposite: the whole cycle
    // exists to find out how far the edge has wandered, so the distance is derived
    // from how far it is allowed to have wandered. Past MAX_SKEW the part is not
    // crooked, it is clamped wrong, and "no contact" is the right answer.
    const MAX_SKEW_DEG = 10
    const reach = Math.max(p.probeDistance, p.approach + spacing * Math.tan((MAX_SKEW_DEG * Math.PI) / 180))
    const far = await probeAxis('Y', yDir, p, reach)
    rel('Z', drop) // lift clear of the part before coming home
    gotoMachine('Y', sy)
    gotoMachine('X', sx)

    onStep?.('done')
    const delta = AX(far, 'Y') - AX(ly, 'Y')
    // The rise is per +X of machine travel, so it is measured against the direction
    // the routine actually walked. `delta * xDir` rather than dividing by `xDir *
    // spacing`, which would hand atan2 a negative second argument and fold the answer
    // around ±180° instead of changing its sign.
    const deg = (Math.atan2(delta * xDir, spacing) * 180) / Math.PI
    setSkewCorner(xDir, yDir, deg, hit.X as Prb, ly, p, plate)
    return { ok: true, angle: deg, note: `∠ ${deg.toFixed(3)}°  ·  Δ ${fmt(delta)} / ${spacing} mm` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/* Hole centre, boss centre and the inside corner used to live here.
 *
 * Hole and boss went on 31 Jul 2026 — Filip: "I don't know how they work or what
 * their logic is, that is why they are not confirmed" — and a hole cannot be probed
 * with a touch plate anyway, since there is nothing inside it to press against.
 *
 * The inside corner (`runCorner`, X and Y only) followed on 3 Aug: "we don't need
 * internal edge measuring for now, only external". It was the last caller of the
 * diagram's pocket drawing, so the External/Internal toggle went with it. All three
 * come back when there is a way to test them.
 *
 * The routines are parked in `.private/probeAdvanced.ts.txt` (gitignored, and
 * outside `src/` so tsc does not compile a file nobody imports). They are also in
 * this file's git history, which is the copy that is actually backed up. */
