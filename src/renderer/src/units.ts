/** Unit helpers. The controller reports positions in the unit selected by $13
 *  (mm or inch); the DRO shows those values verbatim. Jog input is entered in
 *  the active unit and converted to mm for the G21 jog command. */

export type Units = 'mm' | 'inch'

export function fromDisplay(value: number, units: Units): number {
  return units === 'inch' ? value * 25.4 : value
}

/** Format a position already reported in the active unit ($13) — no conversion,
 *  just unit-appropriate precision. */
export function fmtPos(value: number, units: Units): string {
  return units === 'inch' ? value.toFixed(4) : value.toFixed(3)
}

export const unitLabel = (u: Units): string => (u === 'inch' ? 'in' : 'mm')
export const feedLabel = (u: Units): string => (u === 'inch' ? 'in/min' : 'mm/min')
