/**
 * Probe cycle builders. Each returns an ordered list of G-code lines.
 * grblHAL executes them in order and G38.2 blocks until the probe triggers,
 * so sending the sequence is enough — no need to parse [PRB:] for basic cycles.
 *
 * All cycles are self-contained: switch to incremental (G91), probe, set the
 * work zero, retract, then restore absolute (G90).
 */

export interface ZProbeOpts {
  /** max downward travel before giving up (mm) */
  distance: number
  feed: number
  /** touch-plate thickness; work Z is set to this at contact (0 = bare surface) */
  thickness: number
  /** how far to lift after a successful probe (mm) */
  retract: number
}

export function zProbe(o: ZProbeOpts): string[] {
  return [
    'G91',
    `G38.2 Z-${g(o.distance)} F${g(o.feed)}`,
    `G10 L20 P0 Z${g(o.thickness)}`,
    `G0 Z${g(o.retract)}`,
    'G90'
  ]
}

export interface EdgeProbeOpts {
  axis: 'X' | 'Y'
  /** +1 probes toward + direction, -1 toward - direction */
  dir: 1 | -1
  distance: number
  feed: number
  /** probe tip diameter (mm); work zero lands on the material edge */
  tipDiameter: number
  retract: number
}

export function edgeProbe(o: EdgeProbeOpts): string[] {
  // at contact the tool centre sits one tip radius behind the edge, so the
  // work coordinate of the centre is -dir * radius for the edge to read 0.
  const radius = o.tipDiameter / 2
  const offset = -o.dir * radius
  return [
    'G91',
    `G38.2 ${o.axis}${g(o.dir * o.distance)} F${g(o.feed)}`,
    `G10 L20 P0 ${o.axis}${g(offset)}`,
    `G0 ${o.axis}${g(-o.dir * o.retract)}`,
    'G90'
  ]
}

/** compact number formatting, no trailing zeros */
function g(n: number): string {
  return Number(n.toFixed(4)).toString()
}
