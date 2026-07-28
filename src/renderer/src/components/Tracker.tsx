import { useEffect, useMemo, useRef } from 'react'
import { useStore, rotaryRadius } from '../store'
import { buildLineSegments, usesRotary, type LineSeg } from '../toolpath'
import { rotateGcode } from '../gcodeRotate'

// How far AHEAD along the path (in mm) the cursor may look each tick. Kept small
// so it can't jump onto a spatially-near but path-distant pass (parallel finishing
// passes, concentric loops, the star's centre). The CURRENT segment is always
// evaluated in full regardless of this, so a long rapid is still followed. Must
// exceed the tool's per-tick travel (~a few mm at 20 Hz) so the cursor never stalls.
const WINDOW_MM = 30

/** Invisible: derives the executing G-code line AND the job progress fraction from
 *  the live tool position, by following the toolpath's ARC-LENGTH forward-only.
 *
 *  Why arc-length (not "nearest of the next 128 segments"): a straight cut is one
 *  segment but a circle is ~64, so a segment-count window is wildly uneven — huge
 *  for straight moves (jumps across parallel passes), tiny for arcs. Following the
 *  cumulative path length instead gives a physical, monotone cursor that tracks the
 *  real tool position and can't leap onto a nearby-but-later pass. Progress is then
 *  simply cursor/total — the TRUE machined fraction (fixes the acked-count bar that
 *  raced to 100% while the last long moves were still cutting). */
export function Tracker(): null {
  const rawGcode = useStore((s) => s.gcode)
  const rotationDeg = useStore((s) => s.rotationDeg)
  // follow the ROTATED program (what the machine actually executes) so the
  // position-based highlight lines up when software rotation is active
  const gcode = useMemo(() => (rawGcode ? rotateGcode(rawGcode, rotationDeg) : rawGcode), [rawGcode, rotationDeg])
  // segments are in machine coords (WCS offsets applied) → match the live MACHINE
  // position so it lines up across G54–G59.
  const mpos = useStore((s) => s.status?.mpos ?? null)
  const running = useStore((s) => s.job.running)
  const sentLine = useStore((s) => s.sentLine)
  // the file line a resumed run (Park / From-Line) begins at, so the cursor can be
  // seeded there instead of segment 0 — the forward-only arc-length window can't
  // otherwise leap forward to the resume point. -1 = normal top-of-file start.
  const resumeLine = useStore((s) => s.resumeLine)
  const setActiveLine = useStore((s) => s.setActiveLine)
  const setJobProgress = useStore((s) => s.setJobProgress)
  const wcsOffsets = useStore((s) => s.wcsOffsets)
  const wcs = useStore((s) => s.wcs)
  // rotary jobs are tracked in an UNROLLED space so the A rotation counts toward the
  // path length (else pure-A moves are 0-length and the cursor stalls). Both the
  // segments and the live position below are unrolled with the same radius.
  const stock = useStore((s) => s.stock)
  const axes = useStore((s) => s.info.axes)
  // track in unrolled (rotary) space whenever the loaded program uses the A axis —
  // matches the Visualizer, which wraps a rotary program regardless of whether the
  // stock is enabled. Radius/axis come from the stock config (defaults are fine). A
  // flat XY program is never unrolled (a leftover rotary stock can't stall it).
  const rotary =
    gcode && usesRotary(gcode)
      ? {
          axis: stock.rotaryAxis,
          origin: [0, 0, 0] as [number, number, number],
          radius: rotaryRadius(stock)
        }
      : undefined

  // segments + per-segment length and cumulative start-length (so a projection
  // onto a segment maps directly to an arc-length position along the whole path)
  const model = useMemo(() => {
    const segs = gcode ? buildLineSegments(gcode, { offsets: wcsOffsets, wcs, rotary }) : []
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcode, wcsOffsets, wcs, stock])

  const cursor = useRef(0) // index of the segment the tool is currently on

  // Seed the cursor whenever the program changes or a run (re)starts. For a normal
  // start that's segment 0; for a RESUME (Park / From-Line) it's the first segment
  // at/after `resumeLine`, so the highlight, progress and grey colouring continue
  // from the resume point instead of stalling near the start (the forward window
  // can't leap forward on its own — this is why a 2nd park used to capture line ≈0).
  // Also seed the progress so the bar/grey pick up at the resume point immediately.
  useEffect(() => {
    const k = seedCursor(model.segs, resumeLine)
    cursor.current = k
    if (!running) {
      setActiveLine(-1)
      setJobProgress(0)
    } else if (resumeLine >= 0 && model.total > 0) {
      setActiveLine(model.segs[k]?.idx ?? -1)
      setJobProgress(Math.min(1, model.start[k] / model.total))
    }
  }, [running, model, resumeLine, setActiveLine, setJobProgress])

  useEffect(() => {
    const { segs, len, start, total } = model
    if (!running || !mpos || segs.length === 0) return
    const bound = sentLine >= 0 ? sentLine : Infinity
    const i = Math.min(cursor.current, segs.length - 1)

    // match in the same frame the segments were built in: unrolled for rotary
    let livePos = mpos
    if (rotary) {
      const iA = axes.indexOf('A')
      const arc = ((iA >= 0 ? mpos[iA] : 0) * Math.PI * rotary.radius) / 180
      livePos = rotary.axis === 'X' ? [mpos[0], arc, mpos[2]] : [mpos[1], arc, mpos[2]]
    }

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
        if (walked > WINDOW_MM) break // stay within a short forward window of PATH
      }
    }

    cursor.current = bestK
    setActiveLine(segs[bestK].idx)
    const traveled = start[bestK] + bestT * len[bestK]
    setJobProgress(total > 0 ? Math.min(1, traveled / total) : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpos, running, sentLine, model, axes, stock, setActiveLine, setJobProgress])

  return null
}

/** First segment index at/after a resume file line (or 0 for a normal start / when
 *  the line isn't found), so a resumed run's cursor starts where cutting continues. */
function seedCursor(segs: LineSeg[], resumeLine: number): number {
  if (resumeLine < 0) return 0
  for (let k = 0; k < segs.length; k++) if (segs[k].idx >= resumeLine) return k
  return 0
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
