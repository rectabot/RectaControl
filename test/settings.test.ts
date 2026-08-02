/**
 * What a saved `$$` dump does and does not say (src/renderer/src/settingsFile.ts).
 *
 * The case behind this is a backup that looks complete and is not. `$476` — the VFD's
 * Modbus address — only exists once the board has STARTED with a VFD selected, so
 * between writing `$395` and restarting, the board answers `$$` with the drive named and
 * its address absent. A dump taken in that window restores without a word and leaves the
 * address at the factory 1: right for most machines, silently wrong for the rest.
 *
 * The files are the real ones from Filip's machine on 1 Aug 2026 — including the 13:21
 * dump that has `$395=1` and no `$476`.
 */
import { diffDumps, vfdAddressMissing } from '../src/shared/settings-file'
import type { SpindleInfo } from '../src/shared/types'

let failures = 0
let checks = 0

function eq(actual: unknown, expected: unknown, what: string): void {
  checks++
  if (actual === expected) console.log(`  ok   ${what}`)
  else {
    failures++
    console.log(`  FAIL ${what} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
  }
}

/** the board's own `$SPINDLESH` answer: PWM is type 0, every Modbus VFD is type 2 */
const SPINDLES: SpindleInfo[] = [
  { id: 0, name: 'PWM', type: 0, active: true },
  { id: 1, name: 'Huanyang v1', type: 2, active: false },
  { id: 5, name: 'MODVFD', type: 2, active: false }
]

const dump = (...lines: string[]): string => lines.join('\n') + '\n'

export function main(): number {
  console.log('\n1. a dump that names a VFD but carries no address')
  {
    eq(vfdAddressMissing(dump('$100=640.0', '$395=1', '$500=0'), SPINDLES), 1, 'is caught, and says which drive')
    eq(vfdAddressMissing(dump('$395=5'), SPINDLES), 5, 'whichever Modbus driver it names')
  }

  console.log('\n2. …and the dumps that are fine are left alone')
  {
    eq(vfdAddressMissing(dump('$395=1', '$476=1'), SPINDLES), null, 'a VFD dump WITH its address')
    eq(vfdAddressMissing(dump('$395=0', '$100=640.0'), SPINDLES), null, 'an analog PWM spindle, which has no address to lose')
    eq(vfdAddressMissing(dump('$100=640.0'), SPINDLES), null, 'a dump with no $395 at all')
    // the point of asking the board rather than assuming: a non-zero $395 that is not a
    // Modbus drive on THIS firmware has no $476 either, and warning about it is noise
    eq(vfdAddressMissing(dump('$395=9'), SPINDLES), null, 'a spindle id this board does not register')
    eq(vfdAddressMissing(dump('$395=0'), []), null, 'and nothing at all before $SPINDLESH has answered')
  }

  console.log('\n3. the file as it is actually written')
  {
    eq(vfdAddressMissing(dump('$395=1', '$476=2'), SPINDLES), null, 'an address that is not the factory 1')
    eq(vfdAddressMissing('$395=1\r\n$476=1\r\n', SPINDLES), null, 'CRLF line endings')
    eq(vfdAddressMissing(dump(' $395=1 ', ' $476=1 '), SPINDLES), null, 'and leading whitespace')
  }

  console.log('\n4. what a machine has drifted from its baseline in')
  {
    const list = (a: string, b: string): string => diffDumps(a, b).join(',')
    eq(list(dump('$100=640.0', '$110=3500'), dump('$100=640.0', '$110=3500')), '', 'an unchanged machine differs in nothing')
    eq(list(dump('$110=3500'), dump('$110=4000')), '110', 'a changed value is named')
    eq(list(dump('$20=1', '$110=3500'), dump('$20=0', '$110=4000')), '20,110', 'several, in numeric order')
    // the whole reason this is not a string compare: the board answers in its own
    // format, so a machine nobody has touched would otherwise read as fully changed
    eq(list(dump('$100=640'), dump('$100=640.000')), '', '640 and 640.000 are the same setting')
    eq(list(dump('$535='), dump('$535=')), '', 'and an empty value is not a change either')
    // the $476 case this whole feature grew out of: present on one side only
    eq(list(dump('$395=1'), dump('$395=1', '$476=1')), '476', 'a setting the baseline never had counts')
    eq(list(dump('$395=1', '$476=1'), dump('$395=1')), '476', 'and so does one that has gone away')
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures
}
