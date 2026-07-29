/** Unit helpers. The controller reports positions in the unit selected by $13
 *  (mm or inch); the DRO shows those values verbatim. Jog input is entered in
 *  the active unit and converted to mm for the G21 jog command. */

export type Units = 'mm' | 'inch'

export function fromDisplay(value: number, units: Units): number {
  return units === 'inch' ? value * 25.4 : value
}

/** Format a position already reported in the active unit ($13) — no conversion,
 *  just unit-appropriate precision.
 *
 *  A missing value formats as a dash instead of throwing. The DRO draws one row
 *  per axis the controller CLAIMS in `$I`, while the numbers come from status
 *  reports, and the two can disagree for a moment — a report that arrives short,
 *  or a board that reboots mid-line. Reaching past the end of that array used to
 *  take the entire interface down: `undefined.toFixed()` inside a render unmounts
 *  the React tree, leaving a black window in front of a machine that is still
 *  moving. No position is ever worth that. */
export function fmtPos(value: number | undefined | null, units: Units): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return units === 'inch' ? value.toFixed(4) : value.toFixed(3)
}

export const unitLabel = (u: Units): string => (u === 'inch' ? 'in' : 'mm')
export const feedLabel = (u: Units): string => (u === 'inch' ? 'in/min' : 'mm/min')
