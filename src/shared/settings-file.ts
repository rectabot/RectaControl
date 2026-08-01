/**
 * What a saved `$$` dump does and does not say — pure file logic, no store and no React,
 * so both processes use the same rule and test/settings.test.ts can drive it without a
 * machine or a browser.
 */

import type { SpindleInfo } from './types'

/** grblHAL's SpindleType for a Modbus VFD, as reported in the `$SPINDLESH` type field
 *  (`[SPINDLE:1|-|2|SDVE|Huanyang v1]`). The analog PWM spindle reports 0. */
const SPINDLE_TYPE_VFD = 2

/**
 * Does this `$$` dump name a Modbus VFD as the spindle and yet carry no address for it?
 *
 * That combination is not a preference, it is an incomplete backup, and it is easy to
 * create without noticing: `$476` only comes into existence once the board has STARTED
 * with a VFD selected, so between writing `$395` and restarting there is a window where
 * the board answers `$$` with the driver named and the address absent. A dump taken in
 * that window looks complete — it even says which VFD — and restoring it silently leaves
 * the address at the factory 1. For the machine it was taken from that is usually the
 * same number; for anyone whose drive sits on another address it is a spindle that never
 * turns, with a backup that swears everything was saved.
 *
 * Filip's own file from 13:21 on 1 Aug 2026 is exactly this: `$395=1`, no `$476`.
 *
 * Returns null when the dump is fine, or the id of the VFD it names when it is not.
 */
export function vfdAddressMissing(text: string, spindles: SpindleInfo[]): number | null {
  const lines = text.split(/\r?\n/)
  if (lines.some((l) => /^\s*\$476=/.test(l))) return null
  const m = lines.map((l) => /^\s*\$395=(\d+)/.exec(l.trim())).find(Boolean)
  if (!m) return null
  const id = Number(m[1])
  // Only a Modbus spindle has an address to lose. An analog PWM spindle has no `$476`
  // and never did, so a dump without one is complete — warning there would be noise,
  // and noise is how a real warning gets clicked away.
  return spindles.some((s) => s.id === id && s.type === SPINDLE_TYPE_VFD) ? id : null
}
