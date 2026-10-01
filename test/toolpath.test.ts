/**
 * The visualizer's G-code reader (src/renderer/src/toolpath.ts).
 *
 * A full circle in grbl is a G2/G3 with the centre and no end point: the end is the
 * start. The drawing pass skipped any line with no X, Y, Z or A unless it carried
 * an I or an R — so "G2 J5" drew nothing while the line cursor still walked a whole
 * circle over empty space. Found 1 Oct 2026; nothing RectaCAM posts writes it, other
 * CAM does.
 *
 *   npm test        runs this alongside the other suites
 */
import { buildLineSegments, parseToolpath } from '../src/renderer/src/toolpath'

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

/** Width of what the drawing pass drew, in X and Y. */
function extent(gcode: string): { w: number; h: number } {
  const p = parseToolpath(gcode).positions
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i])
    y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1])
  }
  return { w: x1 - x0, h: y1 - y0 }
}

export function main(): number {
  console.log('\n1. a full circle with only its centre')
  {
    const start = 'G21 G90 G0 X0 Y0 Z-1\n'
    for (const arc of ['G2 I5', 'G2 J5', 'G3 I-5', 'G3 J-5', 'G2 I3 J4']) {
      const { w, h } = extent(start + arc)
      ok(Math.abs(w - 10) < 0.01 && Math.abs(h - 10) < 0.01, `"${arc}" draws a Ø10 circle (${w.toFixed(2)} x ${h.toFixed(2)})`)
      const onLine = buildLineSegments(start + arc).filter((s) => s.idx === 1).length
      ok(onLine > 0, `and the line cursor has it too (${onLine} segments)`)
    }
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures
}
