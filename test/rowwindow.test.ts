/**
 * The mounted-row window of the G-code view (src/renderer/src/rowWindow.ts).
 *
 * One property carries this file: while there is a line to show, SOMETHING is mounted.
 * It broke on 3 Aug 2026 in the way that is hardest to notice — the editor came up
 * empty after loading a program from the SD card, but only sometimes, because it
 * depended on how far down the PREVIOUS program had been scrolled. An editor that
 * renders nothing looks exactly like one that failed to load, and the fix that made it
 * "work" was clicking to another tab and back.
 *
 *   npm test        runs this alongside the other suites
 */
import { ROW, OVERSCAN, rowWindow } from '../src/renderer/src/rowWindow'

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

const VIEW = 400 // a measured viewport, 20 rows tall

export async function main(): Promise<number> {
  console.log('\n1. the ordinary case')
  {
    const w = rowWindow(0, VIEW, 4000)
    eq(w.first, 0, 'at the top the window starts at the first line')
    ok(w.last >= VIEW / ROW, `and covers the viewport (${w.last} rows)`)
    const mid = rowWindow(1000 * ROW, VIEW, 4000)
    eq(mid.first, 1000 - OVERSCAN, 'scrolled down it starts an overscan above the view')
    ok(mid.last > 1000 + VIEW / ROW, 'and ends an overscan below it')
  }

  console.log('\n2. the bug: an offset left behind by a longer program')
  {
    // 4112 lines (the Hilbert file) scrolled to line ~2000, then a 37-line program is
    // loaded in its place while the panel is hidden, so nothing resets the offset.
    const w = rowWindow(2000 * ROW, VIEW, 37)
    ok(w.last > w.first, `the window is not empty (${w.first}..${w.last})`)
    ok(w.first < 37, 'and it starts inside the program, not past the end')
    eq(w.first, 0, 'a program shorter than the viewport shows from its first line')
    eq(w.last, 37, 'right through to its last')
  }

  console.log('\n3. …and the same for a program that is merely shorter')
  {
    const w = rowWindow(3000 * ROW, VIEW, 500)
    ok(w.last > w.first, `still not empty (${w.first}..${w.last})`)
    eq(w.last, 500, 'clamped to the end, so the last page is what shows')
    ok(w.first < 500, 'and the start is inside the program')
  }

  console.log('\n4. the property, over the whole range')
  {
    // The one that must never fail again, whatever leaves the offset stale.
    let empty = 0
    let outside = 0
    for (const count of [1, 2, 19, 20, 21, 37, 500, 4112]) {
      for (const scroll of [0, 1, 19, 400, 2000 * ROW, 999999, -50]) {
        for (const box of [0, VIEW, 37]) {
          const w = rowWindow(scroll, box, count)
          if (w.last <= w.first) empty++
          if (w.first < 0 || w.last > count) outside++
        }
      }
    }
    eq(empty, 0, 'no combination of length, scroll and viewport mounts nothing')
    eq(outside, 0, 'and none reaches outside the program')
  }

  console.log('\n5. an empty program mounts nothing, which is correct')
  {
    const w = rowWindow(0, VIEW, 0)
    eq(w.last - w.first, 0, 'no lines, no rows')
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures
}
