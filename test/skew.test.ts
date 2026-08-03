/**
 * The corner of a turned workpiece (src/shared/skew.ts).
 *
 * This is the number the work origin is set to after a skew cycle, so getting it
 * wrong does not look like a measuring error — it looks like the rotation being
 * applied wrongly, which is where Filip's suspicion landed and where mine would have
 * gone too. The case below is the real one: the machine's own log of 3 Aug 2026,
 * every value lifted from `[PRB:]`, and the outcome checked against what the test
 * program did to an unclamped 220 x 264 aluminium plate.
 *
 *   npm test        runs this alongside the other suites
 */
import { skewCorner } from '../src/shared/skew'

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
function near(actual: number, expected: number, tol: number, what: string): void {
  ok(Math.abs(actual - expected) <= tol, `${what} (got ${actual.toFixed(4)}, want ${expected.toFixed(4)} ±${tol})`)
}

/** The cycle from the log at 10:34 on 3 Aug 2026, tip Ø8, no touch plate.
 *
 *   G38.2 X → [PRB:45.641, 73.089, …]   left face, met 73.089 up the machine's Y
 *   G38.2 Y → [PRB:64.228, 55.636, …]   front face, met 64.228 along the machine's X
 *   G38.2 Y → [PRB:114.228, 59.092, …]  the second skew touch, 50 mm further along
 *
 * angle = atan((59.092 − 55.636) / 50) = 3.9545°
 */
const LOG = {
  deg: (Math.atan2(59.092 - 55.636, 50) * 180) / Math.PI,
  left: { x: 45.641, y: 73.089 },
  front: { x: 64.228, y: 55.636 },
  standoffX: 4,
  standoffY: 4,
  xDir: 1 as const,
  yDir: 1 as const
}

export async function main(): Promise<number> {
  console.log('\n1. the angle the two Y touches describe')
  {
    near(LOG.deg, 3.954, 0.001, 'atan(3.456 / 50)')
  }

  console.log('\n2. the corner, against the plate the machine was actually holding')
  {
    const c = skewCorner(LOG)
    // Worked through by hand from the log, and the reason the plate was nudged: the
    // cycle had written 49.655 / 59.648 into G54.
    //
    // The hand working first gave 50.6357 / 58.6965 — 9.5 µm out, because it took the
    // tip radius as a flat 4 mm along the axis rather than 4/cos(angle) across the
    // tilted face. These are the values with that term in, checked back by hand; the
    // 9.5 µm is the same number section 6 measures on purpose.
    near(c.x, 50.6446, 0.001, 'X of the true corner')
    near(c.y, 58.7067, 0.001, 'Y of the true corner')
    ok(Math.abs(c.x - 49.655) > 0.9, `and it is ~1 mm from what was written (${(c.x - 49.655).toFixed(3)} mm in X)`)
    ok(Math.abs(c.y - 59.648) > 0.9, `in the other direction in Y (${(c.y - 59.648).toFixed(3)} mm)`)
  }

  console.log('\n3. the error is the touch distance times the tangent, in both axes')
  {
    const c = skewCorner(LOG)
    const t = Math.tan((LOG.deg * Math.PI) / 180)
    // the left face was met this far ABOVE the corner, the front face this far ALONG it
    const upTheFace = LOG.left.y - c.y
    const alongTheFace = LOG.front.x - c.x
    near(upTheFace * t, 0.995, 0.01, 'X error predicted from how far up the left face was met')
    near(alongTheFace * t, 0.939, 0.01, 'Y error predicted from how far along the front face was met')
  }

  console.log('\n4. a workpiece sitting square is left exactly where it was')
  {
    // The whole correction has to vanish at zero degrees, or every ordinary part on the
    // machine moves by however much this function feels like.
    const c = skewCorner({ ...LOG, deg: 0 })
    near(c.x, LOG.left.x + 4, 1e-9, 'X is the left face, tip radius and no more')
    near(c.y, LOG.front.y + 4, 1e-9, 'Y is the front face')
  }

  console.log('\n5. the correction grows with the angle and reverses with it')
  {
    const plus = skewCorner({ ...LOG, deg: 2 })
    const minus = skewCorner({ ...LOG, deg: -2 })
    const flat = skewCorner({ ...LOG, deg: 0 })
    ok(plus.x > flat.x && minus.x < flat.x, 'turning the part the other way moves the corner the other way in X')
    ok(plus.y < flat.y && minus.y > flat.y, 'and the other way again in Y')
    const small = skewCorner({ ...LOG, deg: 1 })
    const big = skewCorner({ ...LOG, deg: 4 })
    ok(Math.abs(big.x - flat.x) > Math.abs(small.x - flat.x), 'a bigger angle needs a bigger correction')
  }

  console.log('\n6. the tip radius is perpendicular to the face, not along the axis')
  {
    // Small — 9.5 µm at this angle — but it is the difference between a standoff
    // measured off the face and one measured off the machine's axis, and it is free.
    const c = skewCorner(LOG)
    const naive = skewCorner({ ...LOG, standoffX: 4 * Math.cos((LOG.deg * Math.PI) / 180) })
    ok(Math.abs(c.x - naive.x) > 0.005, `r/cos(angle) is worth ${((c.x - naive.x) * 1000).toFixed(1)} µm here`)
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures
}
