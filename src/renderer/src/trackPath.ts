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
 *     board had already parsed ~20 lines into its planner (so the ack bound allowed
 *     them), and the cursor ratcheted to the end of that window. The machine was cutting
 *     1066, exactly as it should have been — only the display had left.
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

/** One tick: match the live tool position against the path from `cursor` forward.
 *
 *  `bound` is the deepest FILE line the controller has acked — nothing past it can be
 *  executing yet. Returns null only when there is no path to match against. */
export interface StepOpts {
  /** only the test passes this — with the guard opened up it reproduces the rule as it
   *  was on 1 Aug 2026, which is how the test proves it catches the jump it describes */
  onPathMm?: number
  /** Search the WHOLE path ahead instead of the short window.
   *
   *  The window is what keeps the cursor from stepping onto a spatially-near but
   *  path-distant pass, and it is the right rule while the cursor is keeping up. It is
   *  the wrong rule once it has fallen behind: the cursor only moves forward and only
   *  sees 30 mm, so a tool that got further than that in one gap between position
   *  reports is gone for good — the highlight freezes while the machine cuts on. That
   *  is not hypothetical. On 1 Aug 2026 arcs_mix.nc ran at F3500 (58 mm/s), where 30 mm
   *  is half a second of travel, and the highlight stopped on line 17 and stayed there
   *  for the rest of the program.
   *
   *  Only the caller knows the cursor has been stuck (it is the one watching the clock),
   *  and only a sustained stall justifies the wider search — a moment off the path is
   *  ordinary and must not open it, or a park retract could re-match somewhere else
   *  entirely. What protects the wide search is the same 2 mm: it accepts nothing the
   *  tool is not standing on. */
  recover?: boolean
}

export function stepCursor(model: TrackModel, cursor: number, livePos: number[], bound: number, opts: StepOpts = {}): Step | null {
  const { segs, len, start, total } = model
  const onPathMm = opts.onPathMm ?? ON_PATH_MM
  if (segs.length === 0) return null
  const i = Math.min(cursor, segs.length - 1)

  let bestK = i
  let bestT = 0
  let bestD = Infinity
  let walked = 0 // path length scanned BEYOND the current segment
  for (let k = i; k < segs.length; k++) {
    if (segs[k].idx > bound) break // nothing past the ack bound is eligible yet
    const { d, t } = projectDist(livePos, segs[k])
    if (d < bestD) {
      bestD = d
      bestK = k
      bestT = t
    }
    if (k > i) {
      walked += len[k]
      // stay within a short forward window of PATH — unless we are trying to find a
      // tool the window has already lost, in which case the whole path ahead is fair
      if (walked > WINDOW_MM && !opts.recover) break
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
