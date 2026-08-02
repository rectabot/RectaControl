/**
 * Every probing cycle drawn the same way: the workpiece from above, and the touches
 * numbered in the order the tool makes them.
 *
 * This replaced a clickable picker — dots you chose from, with an arrow on the one
 * you had picked. Filip's reason for the change is the one that matters: "while I am
 * testing I hold the probe, and I know exactly where it attacks, so I am not going to
 * get hurt." An arrow says which way the tool goes at ONE face. A numbered sequence
 * says what the machine is about to do, all of it, before you press anything — which
 * is what you need when your hands are near the work. Choosing is the row of X0 / Y0 /
 * ZX0 / ZY0 / ZXY0 / XY0 buttons; this only ever shows.
 *
 * Machine convention: +X right, +Y up — so in SVG, where y grows downward, the front
 * face is the bottom edge and the front-left corner is the bottom-left one.
 *
 * Outside faces only, front-left corner only. It used to draw a pocket as well, with
 * the tool inside probing outward — dropped on 3 Aug 2026 ("we don't need internal
 * edge measuring for now, only external"), never having run on a machine. The far
 * faces went at the same time: an X zero taken on the right face shifts the whole cut
 * by the width of the stock, exactly like zeroing the wrong corner, one axis at a
 * time. Those hotspots are in `.private/probeAdvanced.ts.txt` and in git history.
 */

export type Sequence = 'z' | 'x' | 'y' | 'zx' | 'zy' | 'zxy' | 'xy' | 'skew'

type Pt = [number, number]

/** Where the tool actually is at each contact, taken from what the cycles do rather
 *  than from what reads nicely. The block spans 55…145 in both axes, so its
 *  front-left corner is (55, 145). */
const AT: Record<string, Pt> = {
  /** the top face, ~10–15 mm inside the corner — the start for everything with a Z */
  top: [72, 128],
  /** the left face, out past it at the height the cycle started from */
  left: [36, 128],
  /** the front face, back over the material and out past it */
  front: [72, 164],
  /** the front face again, `Spacing` further along — the skew cycle's second point */
  far: [118, 164],
  /** a single face on its own: the tool is wherever the operator put it, which is
   *  nowhere in particular, so it is drawn mid-edge and not tucked into the corner */
  leftMid: [36, 100],
  frontMid: [100, 164],
  /** the tool-height touch, which happens on the plate wherever it is sitting — no
   *  corner involved, so it goes in the middle of the top face */
  middle: [100, 100]
}

/**
 * No direction arrows, on Filip's call after seeing both drawings side by side.
 *
 * They were saying nothing the picture had not already said: a numbered dot sitting
 * outside the left face can only be going one way, into it. Two marks where one will
 * do, in a drawing whose whole job is to be read at a glance with a probe in your
 * hand — and the arrows were the busiest thing in it.
 */
const STEPS: Record<Sequence, Pt[]> = {
  z: [AT.middle],
  x: [AT.leftMid],
  y: [AT.frontMid],
  zx: [AT.top, AT.left],
  zy: [AT.top, AT.front],
  zxy: [AT.top, AT.left, AT.front],
  // The same moves as ZXY0 — it touches the top for the clearance and simply does not
  // write the Z zero — so it is the same picture. Drawing it without that first touch
  // would hide the dive at the top face, which is the one thing about XY0 worth
  // knowing before you press Start.
  xy: [AT.top, AT.left, AT.front],
  skew: [AT.top, AT.left, AT.front, AT.far]
}

/**
 * Which touches DELIVER something you asked for. That is what the tick means.
 *
 * It began as "which touches set a zero", from Filip's rule: "if it touches the
 * height and does not zero it, then there is no tick — that is the real information."
 * He then corrected it on the skew cycle — "point 4 should go green too, without it
 * there is no angle" — and he was right: an origin is not the only thing a probe can
 * hand back. The angle is a result, and the fourth touch is the one that produces it.
 *
 * So the tick is not "the tool has been here", and it is not "an axis was zeroed"
 * either. It is "this touch gave you what you pressed the button for". Exactly one
 * touch in the whole set fails that test, and it keeps its number for the entire run:
 * XY0's first, which dives at the top only to learn how far it may drop beside a
 * face, and deliberately leaves Z as it found it.
 */
const DELIVERS: Record<Sequence, boolean[]> = {
  z: [true],
  x: [true],
  y: [true],
  zx: [true, true],
  zy: [true, true],
  zxy: [true, true, true],
  xy: [false, true, true],
  skew: [true, true, true, true]
}

/**
 * The step token each cycle reports as it BEGINS that touch, so the panel can work
 * out how far along it is: seeing 'Y' means the Z and X touches are behind us.
 *
 * Reading progress from the starts rather than asking the cycles to also announce
 * their finishes keeps `probeRun` as it is — and it cannot lie, because the next
 * token is only ever sent after the previous probe returned. A cycle that fails
 * half way leaves the ticks it had earned, which is correct: those zeros were
 * written, one axis at a time, as it went.
 *
 * `z`, `x` and `y` are the one-touch cycles; `runZ` and `runEdge` report nothing at
 * all, so they are ticked when the run comes back.
 */
export const STEP_TOKENS: Record<Sequence, string[]> = {
  z: [],
  x: [],
  y: [],
  zx: ['Z', 'X'],
  zy: ['Z', 'Y'],
  zxy: ['Z', 'X', 'Y'],
  xy: ['Z', 'X', 'Y'],
  skew: ['Z', 'X', 'Y', '∠']
}

export const stepCount = (what: Sequence): number => STEPS[what].length

export function ProbeSequence({ what, done = 0 }: { what: Sequence; done?: number }): JSX.Element {
  const steps = STEPS[what]
  return (
    // One fixed viewBox for every sequence, cropped to the region the touches live
    // in. Fixed, because a box that tightened around two dots and loosened around
    // four would resize the drawing every time you moved along the row of buttons —
    // and the whole point of the row is that nothing moves while you read it. Cropped,
    // because on the full 0 0 200 200 square more than a third of the picture was
    // empty, and empty SVG is not blank space you can ignore: it is height, pushing
    // the controls below it down the panel.
    <svg viewBox="24 49 127 135" className="w-full max-w-[200px]">
      <rect x="55" y="55" width="90" height="90" rx="3" className="fill-panel2 stroke-border2" strokeWidth="2" />

      {/* the step along the front edge between the two Y contacts — the baseline the
          skew angle is measured over, and the only reason the fourth touch exists */}
      {what === 'skew' && (
        <line
          x1={AT.front[0]}
          y1={AT.far[1] + 12}
          x2={AT.far[0]}
          y2={AT.far[1] + 12}
          className="stroke-border2"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      )}

      {steps.map(([x, y], i) => {
        // Turns green in place as the machine works down the list, so the feedback
        // lands where you are already looking instead of arriving as a line of text
        // that pushes the rest of the window around.
        const set = i < done && DELIVERS[what][i]
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="8" className={set ? 'fill-ok' : 'fill-brand'} />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-[#020617] text-[9px] font-bold">
              {set ? '✓' : i + 1}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
