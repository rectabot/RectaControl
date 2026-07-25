/**
 * Continuous ("Hold" mode) jog goes a long way (CONT_DIST). Once the machine is
 * homed, grblHAL enforces soft limits and rejects a jog whose target is outside
 * the travel — error:15 "Jog exceeds travel", so the axis won't move at all. To
 * avoid that we clamp the continuous distance to the remaining travel toward the
 * limit, leaving a small margin so the move lands just inside.
 */

export interface Move {
  a: string
  s: number
}

/**
 * Max continuous-jog distance (mm) that keeps every involved axis within soft
 * limits. Falls back to `fallback` when the data isn't there (no travel for that
 * axis e.g. a rotary A, or no machine position).
 *
 * grblHAL's machine range for an axis is fixed by the homing direction ($23):
 *   - homes positive/max (bit clear) → home is at 0, work below → range [-L, 0]
 *   - homes negative/min (bit set)   → home is at 0, work above → range [0, L]
 * (L = $13x max travel.) We use $23 rather than guessing from the position sign,
 * which is ambiguous exactly at the home position (MPos 0).
 */
export function clampContinuousJog(
  moves: Move[],
  axes: string[],
  mpos: number[] | null,
  travel: [number, number, number] | null,
  homingDirMask: number,
  fallback: number,
  margin = 0.5
): number {
  if (!mpos || !travel) return fallback
  let dist = fallback
  for (const m of moves) {
    const idx = axes.indexOf(m.a)
    if (idx < 0 || idx >= travel.length) return fallback // rotary / untracked axis
    const pos = mpos[idx]
    const L = travel[idx]
    if (!Number.isFinite(pos) || !Number.isFinite(L) || L <= 0) return fallback
    const homesNeg = ((homingDirMask >> idx) & 1) === 1
    const lower = homesNeg ? 0 : -L
    const upper = homesNeg ? L : 0
    const avail = m.s > 0 ? upper - pos : pos - lower
    dist = Math.min(dist, Math.max(0, avail - margin))
  }
  return dist
}
