/**
 * The cursor that turns a live tool position into "which line is being cut".
 *
 * Lives here rather than inside Tracker.tsx because what it decides is not only a
 * highlight: Park reads the tracked line and Resume rebuilds the program from it, so
 * a cursor that is one line out is a lift-and-plunge one line out — material either
 * skipped or cut twice. That is worth testing headlessly (test/tracker.test.ts)
 * instead of watching a highlight scroll on a machine with a spinning cutter.
 *
 * The cursor is FORWARD-ONLY along the path's arc length, which is what keeps it from
 * jumping onto a spatially-near but path-distant pass — parallel finishing passes and
 * the folds of a raster are millimetres apart and hundreds of lines apart. The cost of
 * forward-only is that a wrong step can never be taken back, which is why the two
 * guards below exist.
 */

import type { LineSeg } from './toolpath'

/** How far AHEAD along the path (mm) the cursor may look each tick. Kept small so it
 *  can't jump onto a spatially-near but path-distant pass. The CURRENT segment is
 *  always evaluated in full regardless, so a long rapid is still followed. Must exceed
 *  the tool's per-tick travel (~2.5 mm at 20 Hz rapid) so the cursor never stalls. */
const WINDOW_MM = 30

/** How far off the path the tool may be and still be considered to be ON the segment
 *  the cursor picked. Executing the program keeps this at ~0 — the machine cuts the
 *  chords the model is built from, and the worst arc-linearisation error is a tenth of
 *  a millimetre — so anything past a couple of millimetres means the tool is not
 *  cutting the program at all.
 *
 *  It is off the program for real reasons, and without this guard every one of them
 *  dragged the cursor forward and could never give it back:
 *   • the parking retract and the rapid to the park spot, which run while the job is
 *     still "running" — that motion moved the line Park then SAVED, i.e. the line the
 *     resume plunges at;
 *   • the resume preamble (lift → rapid across the work → plunge), which is not in the
 *     file at all. On 1 Aug 2026 a job parked on line 1066 came back with the highlight
 *     on 1088 and stuck there for seconds: the tool was 100 mm away flying home, the
 *     board had already parsed ~20 lines into its planner, and the cursor ratcheted to
 *     the end of that window. The machine was cutting 1066, exactly as it should have
 *     been — only the display had left.
 *  A tool that is off the path tells us nothing about which line is executing, so the
 *  honest answer is to keep showing the last line we actually saw it on. */
const ON_PATH_MM = 2

export interface TrackModel {
  segs: LineSeg[]
  /** length of each segment */
  len: number[]
  /** cumulative path length BEFORE each segment */
  start: number[]
  total: number
}

/** Per-segment length + cumulative start-length, so a projection onto a segment maps
 *  directly to an arc-length position along the whole path. */
export function buildTrackModel(segs: LineSeg[]): TrackModel {
  const len: number[] = new Array(segs.length)
  const start: number[] = new Array(segs.length)
  let total = 0
  for (let i = 0; i < segs.length; i++) {
    start[i] = total
    const { a, b } = segs[i]
    len[i] = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    total += len[i]
  }
  return { segs, len, start, total }
}

/** First segment index at/after a resume file line (or 0 for a normal start / when the
 *  line isn't found), so a resumed run's cursor starts where cutting continues. */
export function seedCursor(segs: LineSeg[], resumeLine: number): number {
  if (resumeLine < 0) return 0
  for (let k = 0; k < segs.length; k++) if (segs[k].idx >= resumeLine) return k
  return 0
}

export interface Step {
  cursor: number
  line: number
  progress: number
  /** how far the tool was from the segment this picked — the whole basis of the answer */
  dist: number
  /** false ⇒ the tool is not on the path and `cursor`/`line`/`progress` are the caller's
   *  own, unchanged. Kept as data rather than a null so whoever asks can say WHY the
   *  highlight is standing still, which is the difference between a diagnosis and a
   *  shrug — see the Tracker, which reports a long stall to the log. */
  onPath: boolean
}

export interface StepOpts {
  /** only the test passes this — with the guard opened up it reproduces the rule as it
   *  was on 1 Aug 2026, which is how the test proves it catches the jump it describes */
  onPathMm?: number
  /** How far ahead to look, in mm of path, when the cursor has fallen behind.
   *
   *  The 30 mm window is what keeps the cursor from stepping onto a spatially-near but
   *  path-distant pass, and it is the right rule while the cursor is keeping up. It is
   *  the wrong rule once it has fallen behind: a tool that got further than that in one
   *  gap between position reports is gone for good — forward-only, and blind past 30 mm.
   *  arcs_mix.nc at F3500 (58 mm/s) puts half a second of travel outside the window, and
   *  the highlight stopped on line 17 for the rest of the program.
   *
   *  The first answer to that was to search the WHOLE path ahead. That is too much, and
   *  the machine said so within the hour: a resumed job flew home from the park spot
   *  across a page of concentric circles, at 2 mm above the ones it was crossing, and the
   *  cursor took the first crossing it found — line 49 became 101, then 149, and the
   *  viewer greyed the program to the last six lines. Every one of those matches was a
   *  true 2 mm match. They were just nowhere near where the cut was.
   *
   *  So the reach is bounded by how far the tool could plausibly have travelled since it
   *  was last seen — the caller knows how long that was — rather than by nothing at all.
   *  A crossing beyond that is a coincidence, not a cut. */
  reachMm?: number
}

/** One tick: match the live tool position against the path from `cursor` forward.
 *  Returns null only when there is no path to match against.
 *
 *  There used to be a second rule here: nothing past the controller's ack frontier was
 *  eligible, on the reasoning that the machine cannot be executing a line it has not
 *  answered for. That reasoning is wrong for arcs, and the machine said so on 1 Aug 2026.
 *  grblHAL answers a G2/G3 only once the whole arc is in the planner, and a 364 mm circle
 *  takes most of its own cutting time to get there — so the ack for a big arc lands near
 *  its END, and until then the frontier sits a line BEHIND the cut. arcs_mix.nc stalled
 *  four times a run, always on the two largest circles, always with the tool measured at
 *  exactly the NEXT line's radius (104.0 and 116.0 mm from the circles' centre), and
 *  always with the frontier equal to the line it was stuck on.
 *
 *  Nothing is lost by dropping it: the frontier was a guess at where the tool is, and the
 *  2 mm rule below is a measurement of it. */
export function stepCursor(model: TrackModel, cursor: number, livePos: number[], opts: StepOpts = {}): Step | null {
  const { segs, len, start, total } = model
  const onPathMm = opts.onPathMm ?? ON_PATH_MM
  const reach = Math.max(WINDOW_MM, opts.reachMm ?? 0)
  if (segs.length === 0) return null
  const i = Math.min(cursor, segs.length - 1)

  let bestK = i
  let bestT = 0
  let bestD = Infinity
  let walked = 0 // path length scanned BEYOND the current segment
  for (let k = i; k < segs.length; k++) {
    const { d, t } = projectDist(livePos, segs[k])
    if (d < bestD) {
      bestD = d
      bestK = k
      bestT = t
    }
    if (k > i) {
      walked += len[k]
      if (walked > reach) break // stay within a short forward window of PATH
    }
  }

  if (bestD > onPathMm) {
    const held = Math.min(cursor, segs.length - 1)
    return { cursor: held, line: segs[held].idx, progress: total > 0 ? start[held] / total : 0, dist: bestD, onPath: false }
  }
  const traveled = start[bestK] + bestT * len[bestK]
  return {
    cursor: bestK,
    line: segs[bestK].idx,
    progress: total > 0 ? Math.min(1, traveled / total) : 0,
    dist: bestD,
    onPath: true
  }
}

/** Perpendicular distance from p to segment a→b AND the clamped projection param t
 *  (0 at a, 1 at b) — t turns into an arc-length position along the whole path. */
function projectDist(p: number[], seg: LineSeg): { d: number; t: number } {
  const { a, b } = seg
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const apx = p[0] - a[0]
  const apy = p[1] - a[1]
  const apz = p[2] - a[2]
  const len2 = abx * abx + aby * aby + abz * abz
  const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2)) : 0
  const dx = apx - abx * t
  const dy = apy - aby * t
  const dz = apz - abz * t
  return { d: Math.sqrt(dx * dx + dy * dy + dz * dz), t }
}
