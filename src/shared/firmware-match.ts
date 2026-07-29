/** Does this firmware image fit the board it is about to be flashed onto?
 *
 *  Flashing an image built for a different motor layout is not a cosmetic
 *  mistake, and neither of its two consequences announces itself:
 *
 *  1. grblHAL lays its settings out by axis and motor count, so changing either
 *     resets NVS to compile-time defaults. Every tuned value goes, the spindle
 *     selection goes, and the static IP goes with them — the board comes back on
 *     DHCP and disappears off the network.
 *  2. If the image has no ganging and the machine has a second Y motor, that
 *     motor is never stepped. One side of the gantry moves, the other stays put.
 *
 *  Both happened here on 29 Jul 2026: `4axis-rotary-a` went onto a dual-Y
 *  machine, homing "succeeded" twice on one Y motor, and the job was E-stopped
 *  on its first Y move. Nothing in the app said a word — `[AXS:4:XYZA]` reads
 *  identically for `4axis-rotary-a` and `4axis-a-ganged-y`.
 *
 *  It is cheap to prevent: the board says what it runs, the image says what it
 *  was built for, and the two can be compared before the copy. Pure functions,
 *  no I/O — the comparison is the part worth being sure about.
 */

import type { FirmwareVariant, MachineInfo } from './types'

/** The board's own layout, as far as it can be known from the outside. */
export interface BoardLayout {
  /** Variant id out of our build stamp, when the board runs our firmware. This
   *  is exact; everything below is inference. null on foreign or older builds. */
  variant: string | null
  /** Axis count, or null if $I has not come back. */
  axes: number | null
  /** Does the running image drive a second motor on some axis? null = unknown. */
  secondMotor: boolean | null
}

/** Pull the variant token out of a build stamp: "1.0 4axis-a-ganged-y Jul 29 2026". */
export function stampVariant(build: string | null): string | null {
  const m = /^\S+\s+(\S+)/.exec((build ?? '').trim())
  return m ? m[1] : null
}

/** What the connected board says about itself.
 *
 *  The second-motor flag is the `2` in the first field of `[OPT:…]`, which grbl
 *  emits for `hal.stepper.get_ganged` — set by the driver under GANGING_ENABLED,
 *  so it covers ganged AND auto-squared builds alike (report.c, driver.c). It is
 *  the only outward sign of the difference: the axis letters do not carry it and
 *  neither does [VER:] or [BOARD:].
 *
 *  Only the first OPT field is looked at. The fields after it are plain numbers
 *  (buffer sizes, axis count, tool count) and a bare `includes('2')` over the
 *  whole string would find a `2` in any of them. */
export function readBoardLayout(info: MachineInfo): BoardLayout {
  const flags = (info.options ?? '').split(',')[0]
  return {
    variant: stampVariant(info.firmwareBuild),
    axes: info.axes.length || null,
    secondMotor: info.options ? flags.includes('2') : null
  }
}

/** How an image relates to what is on the board.
 *
 *  `fits` is deliberately weaker than `same`: with no build stamp to go by, a
 *  ganged and an auto-squared image look alike from outside (both report the
 *  same `2` flag), so agreement on axes and motor count is as far as the
 *  inference honestly goes. */
export interface Fit {
  kind: 'unknown' | 'same' | 'fits' | 'differs'
  /** On 'differs': axis count goes from → to. */
  axes?: [number, number]
  /** On 'differs': the image gains (true) or loses (false) the second motor. */
  secondMotor?: boolean
}

export function fitVariant(board: BoardLayout, v: FirmwareVariant): Fit {
  if (board.variant && board.variant === v.variant) return { kind: 'same' }
  const cfg = v.config
  // A hand-picked .uf2 has no build.conf beside it, and nothing else on disk
  // says what it is — better to admit that than to guess from the file name.
  if (!cfg) return { kind: 'unknown' }
  if (board.axes == null && board.secondMotor == null) return { kind: 'unknown' }

  const fit: Fit = { kind: 'fits' }
  if (board.axes != null && board.axes !== cfg.axes) {
    fit.kind = 'differs'
    fit.axes = [board.axes, cfg.axes]
  }
  const wants = cfg.secondMotor.length > 0
  if (board.secondMotor != null && board.secondMotor !== wants) {
    fit.kind = 'differs'
    fit.secondMotor = wants
  }
  return fit
}
