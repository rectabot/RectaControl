import { useEffect, useMemo, useRef } from 'react'
import { useStore, rotaryRadius } from '../store'
import { buildLineSegments, usesRotary } from '../toolpath'
import { buildTrackModel, reachFor, seedCursor, stepCursor } from '../trackPath'
import { rotateGcode } from '../gcodeRotate'

/** How long the highlight may stand still before the log is told why. Long enough that
 *  the ordinary off-path moments — the flight home from a park, the first rapid of a
 *  run — pass without a word. */
const STALL_MS = 3000
/** …but longer before the tool has ever been seen on the path this run. Every run starts
 *  with the machine deliberately away from the program — travelling to the start, or home
 *  from a park across the work — and that is seconds of legitimately held highlight, not a
 *  fault. A resumed Hilbert job reported one every time. Past this, though, it IS the
 *  fault worth hearing about: a run that never finds its own path has a drawing and a
 *  machine that disagree. */
const STALL_UNLOCKED_MS = 15000
/** …and how often to say it again while it goes on. */
const STALL_REPEAT_MS = 10000

/** Invisible: derives the executing G-code line AND the job progress fraction from
 *  the live tool position, by following the toolpath's ARC-LENGTH forward-only.
 *
 *  Why arc-length (not "nearest of the next 128 segments"): a straight cut is one
 *  segment but a circle is ~64, so a segment-count window is wildly uneven — huge
 *  for straight moves (jumps across parallel passes), tiny for arcs. Following the
 *  cumulative path length instead gives a physical, monotone cursor that tracks the
 *  real tool position and can't leap onto a nearby-but-later pass. Progress is then
 *  simply cursor/total — the TRUE machined fraction (fixes the acked-count bar that
 *  raced to 100% while the last long moves were still cutting).
 *
 *  The matching itself lives in trackPath.ts, where it can be tested headlessly —
 *  Park saves the line this produces and Resume plunges at it. */
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
  const paused = useStore((s) => s.job.paused)
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

  const model = useMemo(() => {
    return buildTrackModel(gcode ? buildLineSegments(gcode, { offsets: wcsOffsets, wcs, rotary }) : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcode, wcsOffsets, wcs, stock])

  const cursor = useRef(0) // index of the segment the tool is currently on
  const stallSince = useRef(0) // when the tool first went off the path (0 = it isn't)
  const stallLogged = useRef(0) // when it was last reported (0 = not this stall)
  const locked = useRef(false) // has the tool been matched to the path at all this run?

  // Seed the cursor whenever the program changes or a run (re)starts. For a normal
  // start that's segment 0; for a RESUME (Park / From-Line) it's the first segment
  // at/after `resumeLine`, so the highlight, progress and grey colouring continue
  // from the resume point instead of stalling near the start (the forward window
  // can't leap forward on its own — this is why a 2nd park used to capture line ≈0).
  // The line is published right away, for both kinds of start: the tool spends the
  // first moments of a run travelling TO the path (a resume rapids in from the park
  // spot), and until it arrives there is nothing to match against — see stepCursor.
  useEffect(() => {
    const k = seedCursor(model.segs, resumeLine)
    cursor.current = k
    // A new run starts having seen nothing: the clock that decides how far to reach for a
    // lost tool must not carry over from the last one. Left running across a park it read
    // 13 s at the moment the resume began, which bought the widest reach there is at the
    // exact moment the tool was furthest from the program.
    stallSince.current = 0
    stallLogged.current = 0
    locked.current = false
    if (!running) {
      setActiveLine(-1)
      setJobProgress(0)
    } else if (model.total > 0) {
      setActiveLine(model.segs[k]?.idx ?? -1)
      setJobProgress(Math.min(1, model.start[k] / model.total))
    }
  }, [running, model, resumeLine, setActiveLine, setJobProgress])

  useEffect(() => {
    if (!running || !mpos || model.segs.length === 0) return

    // match in the same frame the segments were built in: unrolled for rotary
    let livePos = mpos
    if (rotary) {
      const iA = axes.indexOf('A')
      const arc = ((iA >= 0 ? mpos[iA] : 0) * Math.PI * rotary.radius) / 180
      livePos = rotary.axis === 'X' ? [mpos[0], arc, mpos[2]] : [mpos[1], arc, mpos[2]]
    }

    // Once the highlight has stood still for a moment, look further ahead — the tool may
    // have crossed the window in one gap between reports, and the narrow search would
    // never find it again. How far is reachFor()'s decision, and it is only ever more
    // than nothing for a tool that WAS being tracked (see there).
    const missing = stallSince.current > 0 ? Date.now() - stallSince.current : 0
    const next = stepCursor(model, cursor.current, livePos, { reachMm: reachFor(missing, locked.current) })
    if (!next) return
    if (!next.onPath) {
      // The tool is not on the path we drew, so the last line we saw it on still stands.
      // Standing still is the honest answer, but a highlight that stops looks exactly
      // like a highlight that is broken — and from outside there is no way to tell the
      // two apart. So say it once, with the number that decides it: how far off the
      // drawn path the machine actually is. Millimetres means the guard is too tight;
      // tens of millimetres means the drawing and the machine disagree, and the
      // highlight is the messenger.
      const now = Date.now()
      if (stallSince.current === 0) stallSince.current = now
      // …but not while the machine is deliberately parked off the path. A held highlight
      // is the correct answer to a pause, and saying so every few seconds only buries the
      // times it isn't.
      else if (
        !paused &&
        now - stallSince.current > (locked.current ? STALL_MS : STALL_UNLOCKED_MS) &&
        now - stallLogged.current > STALL_REPEAT_MS
      ) {
        stallLogged.current = now
        const at = livePos.map((v, i) => `${'XYZABC'[i] ?? i}${v.toFixed(3)}`).join(' ')
        // Repeated while it lasts, not once: a single sample cannot say whether the tool
        // is drifting away from the path or the whole program is running somewhere else,
        // and those want different fixes.
        window.recta.logWrite(
          'ui',
          // the ack frontier does not gate the match any more (see stepCursor), but it
          // still says how far the controller had got, which is worth having beside it
          `tracker: held on line ${next.line + 1} for ${Math.round((now - stallSince.current) / 1000)} s — tool is ${next.dist.toFixed(1)} mm off the drawn path at machine ${at} (acked to ${sentLine + 1})`
        )
      }
      return
    }
    stallSince.current = 0
    stallLogged.current = 0
    locked.current = true // the tool has been seen on the path; recovery is now meaningful
    cursor.current = next.cursor
    setActiveLine(next.line)
    setJobProgress(next.progress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpos, running, paused, sentLine, model, axes, stock, setActiveLine, setJobProgress])

  return null
}
