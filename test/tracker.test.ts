/**
 * The position → G-code-line cursor (src/renderer/src/trackPath.ts).
 *
 * This is the number Park saves and Resume plunges at, so a wrong one is not a
 * cosmetic problem: it decides which line the machine re-enters the material on.
 *
 * The scenario is the one run on the machine on 1 Aug 2026 — engrave_test.nc (a
 * Hilbert curve: 2.857 mm chords, neighbouring passes 2.857 mm apart but hundreds of
 * lines apart along the path), parked around line 1066 with the park spot 100 mm clear
 * of the work, then resumed. The app came back with the highlight on 1088.
 *
 *   npm test        runs this alongside the streaming suite
 */
import { buildLineSegments } from '../src/renderer/src/toolpath'
import { buildTrackModel, seedCursor, stepCursor, type TrackModel } from '../src/renderer/src/trackPath'

let failures = 0
let checks = 0

function ok(cond: boolean, what: string): void {
  checks++
  if (cond) console.log(`  ok   ${what}`)
  else {
    failures++
    console.log(`  FAIL ${what}`)
  }
}
function eq(actual: unknown, expected: unknown, what: string): void {
  ok(actual === expected, `${what} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

const PITCH = 2.857 // mm — engrave_test.nc's chord length AND its pass spacing
const DEPTH = -0.3

/** A tightly folded serpentine — the geometry that makes this hard, and what a Hilbert
 *  curve is made of: the run beside the one being cut is a single pitch away in space
 *  and a fold away along the path, so a tool lifted a few mm is nearer to the wrong
 *  line than to the right one. */
function program(passes: number, perPass: number): string {
  const out: string[] = ['G21 G90 G17', 'G0 Z5', 'M3 S6000', 'G0 X0 Y0', `G1 Z${DEPTH} F300`]
  for (let p = 0; p < passes; p++) {
    const y = p * PITCH
    for (let i = 1; i <= perPass; i++) {
      const x = (p % 2 === 0 ? i : perPass - i) * PITCH
      out.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F1500`)
    }
    out.push(`G1 Y${(y + PITCH).toFixed(3)}`)
  }
  return out.join('\n')
}

type Cursor = { cursor: number; line: number; stalled: boolean }

/** Fly the tool along a straight move, sampling at the 20 Hz status rate and feeding
 *  every sample to the cursor exactly as the Tracker does. `onPathMm` is only passed
 *  to reproduce the pre-fix rule. */
function fly(
  m: TrackModel,
  state: Cursor,
  from: number[],
  to: number[],
  mmPerSec: number,
  onPathMm?: number,
  hz = 20
): void {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
  const ticks = Math.max(1, Math.ceil(d / (mmPerSec / hz)))
  for (let i = 1; i <= ticks; i++) {
    const p = [0, 1, 2].map((ax) => from[ax] + (to[ax] - from[ax]) * (i / ticks))
    // the component widens the search once the highlight has stood still (RECOVER_MS);
    // at these rates one missed sample is already longer than that
    const next = stepCursor(m, state.cursor, p, { onPathMm, recover: state.stalled })
    if (next?.onPath) {
      state.cursor = next.cursor
      state.line = next.line
      state.stalled = false
    } else {
      state.stalled = true
    }
  }
}

export function main(): number {
  const gcode = program(400, 3)
  const segs = buildLineSegments(gcode)
  const model = buildTrackModel(segs)
  const AT = 500 // the segment the hold stops on
  const stop = segs[AT]
  const mid = [0, 1, 2].map((ax) => (stop.a[ax] + stop.b[ax]) / 2)

  console.log('\n1. the cursor rides the tool through the cut')
  {
    const state: Cursor = { cursor: 0, line: -1, stalled: false }
    let seen = 0
    let cut = 0
    for (let k = 0; k < 400; k++) {
      const s = segs[k]
      if (model.len[k] < 0.01) continue // a G0 that repeats the position — no line to be on
      cut++
      fly(model, state, s.a, s.b, 1500 / 60)
      if (state.line === s.idx) seen++
    }
    eq(seen, cut, `reported the right line on every one of ${cut} segments`)
  }

  console.log('\n2. parking the head does not move the line Park saves')
  {
    // The job is still "running" through grblHAL's own parking motion — the $56 pullout
    // and the move to $58 — and whatever line is showing when it settles is what
    // parkForAccess() stores and Resume plunges at. (The app's own G53 park moves come
    // after the abort, when the tracker is already off.) A straight lift keeps the
    // segment underneath the nearest one, so this holds either way — the point of the
    // check is that it stays that way if the parking axis or the geometry changes.
    const seed = stepCursor(model, seedCursor(segs, stop.idx), mid)!
    const state: Cursor = { cursor: seed.cursor, line: seed.line, stalled: false }
    const stoppedOn = state.line

    fly(model, state, mid, [mid[0], mid[1], mid[2] + 5], 500 / 60)
    fly(model, state, [mid[0], mid[1], mid[2] + 5], [mid[0], mid[1], 20], 3000 / 60)
    eq(state.line, stoppedOn, 'the line survives the pullout and the park retract')
  }

  console.log('\n3. the resume preamble does not run the highlight ahead of the cut')
  {
    // resumeFromPark() seeds at the parked line and streams lift → rapid across the
    // work → plunge. None of that is in the file, and by the end of the rapid the board
    // has parsed a dozen file lines into its planner — so nothing but the tool's own
    // position stands between the highlight and the end of the window.
    const parkLine = stop.idx
    const k = seedCursor(segs, parkLine)
    const target = segs[k].a

    const state: Cursor = { cursor: k, line: parkLine, stalled: false }
    fly(model, state, [200, 100, 20], [target[0], target[1], 5], 3000 / 60)
    eq(state.line, parkLine, 'the rapid home from the park spot leaves it on the resume line')
    fly(model, state, [target[0], target[1], 5], target, 300 / 60)
    eq(state.line, parkLine, 'and the plunge lands on the line the machine is about to cut')

    const old: Cursor = { cursor: k, line: parkLine, stalled: false }
    fly(model, old, [200, 100, 20], [target[0], target[1], 5], 3000 / 60, Infinity)
    ok(
      old.line > parkLine,
      `without the guard the flight home drags it ahead of the cut (${parkLine + 1} → ${old.line + 1}, machine cutting ${parkLine + 1})`
    )

    // and once the machine really is cutting again, the cursor follows it line by line
    for (let j = k; j < k + 30; j++) fly(model, state, segs[j].a, segs[j].b, 1500 / 60)
    eq(state.line, segs[k + 29].idx, 'the cut is followed line by line from the resume point')
  }

  console.log('\n4. a gap between position reports does not lose the tool for good')
  {
    // arcs_mix.nc, 1 Aug 2026: F3500 is 58 mm/s, so the 30 mm window is half a second of
    // travel. One slow moment and the tool is past it — and because the cursor only ever
    // moves forward and only ever looks 30 mm ahead, nothing brings it back: the
    // highlight stopped on line 17 and stayed there for the remaining two minutes of the
    // program, with the machine cutting and the tool marker riding the path correctly.
    const state: Cursor = { cursor: 0, line: -1, stalled: false }
    for (let k = 0; k < 60; k++) fly(model, state, segs[k].a, segs[k].b, 1500 / 60)
    const before = state.line

    // one report every 1.5 s at 58 mm/s — 87 mm apart, three times the window
    for (let k = 60; k < 300; k++) fly(model, state, segs[k].a, segs[k].b, 3500 / 60, undefined, 2 / 3)
    ok(state.line > before, `the highlight kept moving through the sparse stretch (${before + 1} → ${state.line + 1})`)

    // and it is on the tool, not merely somewhere ahead of where it was
    for (let k = 300; k < 320; k++) fly(model, state, segs[k].a, segs[k].b, 1500 / 60)
    eq(state.line, segs[319].idx, 'and lands back on the line the tool is actually cutting')
  }

  console.log('\n5. a big arc is followed before the board has answered for it')
  {
    // grblHAL answers a G2/G3 only once the whole arc is in the planner, and a 364 mm
    // circle takes most of its own cutting time to get there — so for those seconds the
    // ack frontier sits a line BEHIND the cut. Bounding the highlight by it stalled
    // arcs_mix.nc four times a run, always on the two largest circles, always with the
    // tool measured at exactly the next line's radius. The cursor follows the tool.
    const arcs = ['G21 G90 G17', 'G0 X266 Y150 Z5', 'G1 Z-2 F3500', 'G3 X34 Y150 I-116 J0 F3500', 'G3 X266 Y150 I116 J0 F3500'].join('\n')
    const asegs = buildLineSegments(arcs)
    const amodel = buildTrackModel(asegs)
    const first = asegs.findIndex((s) => s.idx === 3) // the r=116 half circle
    const state: Cursor = { cursor: 0, line: -1, stalled: false }
    for (let k = 0; k < first; k++) fly(amodel, state, asegs[k].a, asegs[k].b, 3500 / 60)
    const beforeArc = state.line

    for (let k = first; k < asegs.length; k++) fly(amodel, state, asegs[k].a, asegs[k].b, 3500 / 60)
    ok(state.line > beforeArc, `the arc is tracked, not held at the line before it (${beforeArc + 1} → ${state.line + 1})`)
    eq(state.line, asegs[asegs.length - 1].idx, 'and ends on the last line of the program')
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures
}
