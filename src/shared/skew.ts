/**
 * Where the corner of a turned workpiece actually is.
 *
 * The corner cycle takes the X zero from the left face and the Y zero from the front
 * face, and on a workpiece sitting square to the machine that is exact. On a turned
 * one it is not, and the reason is that neither touch happens AT the corner: the
 * operator starts the cycle from one spot inside the corner and each probe goes
 * straight out from there, so the left face is met ~14 mm above the corner and the
 * front face ~14 mm along it. Every millimetre away from the corner slides the
 * contact along a face that is no longer parallel to the axis being probed, and each
 * zero misses by `distance_along_the_face × tan(angle)`.
 *
 * Measured on the machine on 3 Aug 2026, on an aluminium plate turned 3.954°: the
 * left face was touched 14.392 mm above the corner and the front face 13.592 mm
 * along it, giving 0.995 mm of X error and 0.939 mm of Y error. The test program laps
 * the 220 × 264 plate with 1 mm of clearance and caught exactly that — the front and
 * right sides touched (0.05 and 0.02 mm of overlap) while the back had 1.95 mm of
 * room. The angle itself was right: a rotation applied the wrong way would have
 * missed the far end by 220·sin(2θ) = 30 mm, not by one.
 *
 * So intersect the two faces properly instead of taking one coordinate from each.
 * Each face is a line through its own contact point at the measured angle:
 *
 *   front face:  Y = ay + t·(X − ax)     through the front contact, rising with X
 *   left  face:  X = bx − t·(Y − by)     perpendicular to it, through the left one
 *
 * Substituting one into the other gives the closed form below. Nothing is re-probed —
 * every number comes out of the cycle that has just run.
 *
 * Kept free of the store and of React so it can be checked headlessly against the
 * numbers the machine really produced — see test/skew.test.ts.
 */

export interface SkewCornerInput {
  /** Measured skew of the front edge against machine X, in degrees. */
  deg: number
  /** The left-face contact, from `[PRB:]`: the tip's machine X, and the Y it stood at. */
  left: { x: number; y: number }
  /** The front-face contact, from `[PRB:]`: the tip's machine Y, and the X it stood at. */
  front: { x: number; y: number }
  /** Standoff from tip centre to the left face, measured PERPENDICULAR to it
   *  (tip radius + touch-plate thickness). */
  standoffX: number
  /** The same for the front face. */
  standoffY: number
  /** Which way each probe travelled. Front-left is (+1, +1) and is the only corner
   *  the panel offers; carried through so the arithmetic states its assumption. */
  xDir: 1 | -1
  yDir: 1 | -1
}

/** The machine coordinates of the true corner — what the work origin should be. */
export function skewCorner(i: SkewCornerInput): { x: number; y: number } {
  const rad = (i.deg * Math.PI) / 180
  const t = Math.tan(rad)
  const cos = Math.cos(rad)
  // A standoff is perpendicular to the face; the probe travelled along an axis. Over
  // that axis it therefore spans standoff / cos(angle) — 9.5 µm more than the radius
  // itself at 3.954°, and it grows as the square of the angle.
  const bx = i.left.x + i.xDir * (i.standoffX / cos) // left face, at height left.y
  const by = i.left.y
  const ay = i.front.y + i.yDir * (i.standoffY / cos) // front face, at along-distance front.x
  const ax = i.front.x
  const x = (bx + t * (by - ay) + t * t * ax) / (1 + t * t)
  return { x, y: ay + t * (x - ax) }
}
