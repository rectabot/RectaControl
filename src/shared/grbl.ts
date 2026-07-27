/**
 * grbl / grblHAL protocol helpers — ported from the Python proof-of-concept
 * (rectacontrol/grbl.py). Status-report parsing and command builders.
 *
 * A status report looks like:
 *   <Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>
 *   <Run|WPos:12.340,5.000,-3.200|FS:800,12000|Ov:100,100,100|Pn:PXYZ>
 * We want machine state plus a *work* position (WPos). grblHAL usually reports
 * MPos plus a periodic WCO (work-coordinate offset), so WPos = MPos - WCO.
 * The cached WCO lets us compute WPos whenever only MPos is present.
 */

import type { SpindleInfo, StatusReport } from './types'

const STATUS_RE = /^<(.+)>$/

// Machine-readable spindle enumeration line from `$SPINDLESH`:
//   [SPINDLE:<id>|<num or ->|<type>|<caps>|<name>[|<rpmMin>,<rpmMax>]]
// `caps` holds flags, including '*' for the currently active spindle. The pipes
// distinguish this from the plain `[SPINDLE:PWM]` active-name line emitted by $I.
const SPINDLE_ENUM_RE = /^\[SPINDLE:(\d+)\|[^|]*\|(\d+)\|([^|]*)\|([^|\]]*)/

/** Parse one machine-readable `$SPINDLESH` line into a SpindleInfo, or null if the
 *  line isn't an enumeration entry (e.g. the plain `[SPINDLE:PWM]` from $I). */
export function parseSpindleEntry(line: string): SpindleInfo | null {
  const m = SPINDLE_ENUM_RE.exec(line)
  if (!m) return null
  return { id: Number(m[1]), type: Number(m[2]), active: m[3].includes('*'), name: m[4].trim() }
}

export class StatusParser {
  private wco: number[] = []

  parse(line: string): StatusReport | null {
    const m = STATUS_RE.exec(line.trim())
    if (!m) return null

    const fields = m[1].split('|')
    const state = fields[0]
    let mpos: number[] | null = null
    let wpos: number[] | null = null
    let feed: number | null = null
    let spindle: number | null = null
    let spindleActual: number | null = null
    let accessory: string | null = null
    let ov: [number, number, number] | null = null
    let pins: string | null = null
    let homed: boolean | null = null

    for (const f of fields.slice(1)) {
      const idx = f.indexOf(':')
      if (idx < 0) continue
      const key = f.slice(0, idx)
      const val = f.slice(idx + 1)
      switch (key) {
        case 'MPos':
          mpos = coords(val)
          break
        case 'WPos':
          wpos = coords(val)
          break
        case 'WCO': {
          const w = coords(val)
          if (w) this.wco = w
          break
        }
        case 'FS': {
          const parts = val.split(',')
          feed = num(parts[0])
          spindle = num(parts[1])
          // grblHAL appends actual spindle RPM (3rd value) when the spindle
          // exposes get_data — e.g. the Huanyang VFD over Modbus.
          spindleActual = num(parts[2])
          break
        }
        case 'F':
          feed = num(val)
          break
        case 'A':
          accessory = val
          break
        case 'Ov':
          ov = triple(val)
          break
        case 'Pn':
          pins = val
          break
        // |H:1 / |H:0 — the controller's OWN homed status, reported when it
        // changes. It is the only honest source: grblHAL drops the reference by
        // itself when a reset loses position ($676 bit 0), which no amount of
        // watching state transitions from outside can infer.
        case 'H':
          homed = val.split(',')[0] === '1'
          break
      }
    }

    let resolvedW: number[] | null = null
    let resolvedM: number[] | null = null
    if (wpos) {
      resolvedW = wpos
      resolvedM = wpos.map((v, i) => v + (this.wco[i] ?? 0))
    } else if (mpos) {
      resolvedM = mpos
      resolvedW = mpos.map((v, i) => v - (this.wco[i] ?? 0))
    }

    return { state, wpos: resolvedW, mpos: resolvedM, feed, spindle, spindleActual, accessory, ov, pins, homed }
  }
}

/** Parse a comma-separated coordinate list of any length (X,Y,Z,A,…). */
function coords(val: string): number[] | null {
  const nums = val.split(',').map(Number)
  if (nums.length < 1 || nums.some((n) => Number.isNaN(n))) return null
  return nums
}

function triple(val: string): [number, number, number] | null {
  const nums = val.split(',').map(Number)
  if (nums.length < 3 || nums.some((n) => Number.isNaN(n))) return null
  return [nums[0], nums[1], nums[2]]
}

function num(v: string | undefined): number | null {
  if (v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/** Incremental jog command (metric, relative). */
export function jog(axis: string, distance: number, feed: number): string {
  return `$J=G91 G21 ${axis}${trim(distance)} F${trim(feed)}`
}

/** Set the work position of an axis to a value (default 0) in the active WCS. */
export function setZero(axis: string, value = 0): string {
  return `G10 L20 P0 ${axis}${trim(value)}`
}

/** Set one axis of a specific WCS (P1=G54 … P6=G59) to an explicit machine
 *  coordinate — `G10 L2 P<n> <axis><value>`. Used by the Offsets table. */
export function setOffset(p: number, axis: string, value: number): string {
  return `G10 L2 P${p} ${axis}${trim(value)}`
}

/** Zero a specific WCS (P1=G54 … P6=G59) at the current position across the
 *  given axes — `G10 L20 P<n> X0 Y0 …`. */
export function zeroWcs(p: number, axes: string[]): string {
  return `G10 L20 P${p} ${axes.map((a) => `${a}0`).join(' ')}`
}

function trim(n: number): string {
  // compact number, no trailing zeros (like '%g')
  return Number(n.toFixed(4)).toString()
}

/** True for a status report line. */
export function isStatus(line: string): boolean {
  return STATUS_RE.test(line.trim())
}

/** Strip ; line comments and ( ... ) block comments. Used by both the streamer
 *  (to decide which lines are sent) and the preview (to map highlight to lines). */
export function stripComment(line: string): string {
  const semi = line.indexOf(';')
  const s = semi >= 0 ? line.slice(0, semi) : line
  return s.replace(/\([^)]*\)/g, '')
}

/** grbl realtime command bytes. */
export const RT = {
  status: 0x3f, // ?
  feedHold: 0x21, // !
  resume: 0x7e, // ~
  softReset: 0x18, // Ctrl-X
  jogCancel: 0x85,
  // feed override
  feed100: 0x90,
  feedPlus10: 0x91,
  feedMinus10: 0x92,
  feedPlus1: 0x93,
  feedMinus1: 0x94,
  // rapid override
  rapid100: 0x95,
  rapid50: 0x96,
  rapid25: 0x97,
  // spindle override
  spindle100: 0x99,
  spindlePlus10: 0x9a,
  spindleMinus10: 0x9b,
  spindlePlus1: 0x9c,
  spindleMinus1: 0x9d
} as const
