/**
 * Which commands move the work origin (src/shared/grbl.ts → movesOrigin).
 *
 * This predicate decides whether the app goes and re-reads `$#` after a command. Say
 * no when the answer is yes and the 3D view keeps drawing the toolpath around an
 * origin the machine has stopped using — which is what happened on 3 Aug 2026: jog Z
 * down 20 mm, press Z0 in the DRO, run the program, and the tool marker never touched
 * the cut, nothing greyed out behind it and the G-code editor held on its first line.
 * The tracker logged `tool is 20.0 mm off the drawn path`: the jog, exactly.
 *
 * Say yes when the answer is no and the app puts a needless `$#` on the wire — much
 * cheaper, so the doubtful cases here lean that way on purpose.
 *
 *   npm test        runs this alongside the streaming and tracker suites
 */
import { movesOrigin, setZero, setOffset, zeroWcs } from '../src/shared/grbl'

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

export async function main(): Promise<number> {
  console.log('\n1. the commands the app itself builds')
  {
    // Whatever these grow into, the watcher has to keep recognising them — that is the
    // whole reason to test the builders' output rather than hand-written strings.
    ok(movesOrigin(setZero('Z', 0)), `DRO / keyboard zero — ${setZero('Z', 0)}`)
    ok(movesOrigin(setZero('X', 12.5)), `zero to a value — ${setZero('X', 12.5)}`)
    ok(movesOrigin(setOffset(1, 'Y', -40)), `offsets table cell — ${setOffset(1, 'Y', -40)}`)
    ok(movesOrigin(zeroWcs(2, ['X', 'Y', 'Z'])), `zero a whole WCS — ${zeroWcs(2, ['X', 'Y', 'Z'])}`)
  }

  console.log('\n2. typed by hand, and by the probe')
  {
    ok(movesOrigin('G10 L20 P0 Z0'), 'the exact line from the 3 Aug log')
    ok(movesOrigin('g10 l20 p0 z0'), 'lower case — the console does not shout')
    // legal to type, and grblHAL reads it the same — there is no word boundary after
    // the L20 at all, which is why the pattern asks about digits instead
    ok(movesOrigin('G10L20P0Z0'), 'no spaces')
    ok(movesOrigin('G92X0Y0'), 'nor after the G92')
    ok(movesOrigin('G10 L20 P0 Z1.5'), "the probe's own zero, plate thickness and all")
    ok(movesOrigin('G92 X0 Y0'), 'G92 temporary shift')
    ok(movesOrigin('G92.1'), 'and cancelling it moves the origin back')
  }

  console.log('\n3. what must NOT set it off')
  {
    // Every one of these is sent constantly; a false yes here is an `$#` burst after
    // every jog, and `$#` is refused mid-motion anyway.
    ok(!movesOrigin('$J=G91 G21 Z-10 F4000'), 'a jog')
    ok(!movesOrigin('G53 G0 Z0'), 'a rapid in machine coordinates')
    ok(!movesOrigin('G90 G0 X0 Y0'), 'a rapid to the work zero')
    ok(!movesOrigin('$H'), 'homing — it does not touch the offsets')
    ok(!movesOrigin('$#'), 'the read itself, which would otherwise loop')
    ok(!movesOrigin('G54'), 'switching WCS: nothing moved, and we hold them all already')
    ok(!movesOrigin('G59.3'), 'nor an extended one')
    ok(!movesOrigin('G38.2 Z-25 F100'), 'a probe move — the zero comes after it, separately')
    // the boundaries the pattern leans on
    ok(!movesOrigin('G102 L2000'), 'a G-word that merely starts with G10')
    ok(!movesOrigin('G921'), 'and one that merely starts with G92')
    ok(!movesOrigin('G10 L200 P1'), 'an L-word that merely starts with L20')
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures
}
