/**
 * Machine-state colours — one source of truth for every place the controller's
 * state is shown (TopBar today; anything else that grows later).
 *
 * The scheme deliberately does NOT reuse the action palette. An action button's
 * colour answers "what happens if I press this" (green = go/Home, amber = caution/
 * Unlock, red = Reset/Stop, purple = Park). A state colour answers "what is the
 * machine doing right now", and the two must not be read as the same sentence —
 * a green Home BUTTON that starts homing is not the same thing as the machine
 * BEING in the homing cycle.
 *
 * So states are grouped by what they mean for the operator:
 *
 *   ready     green   Idle — safe, waiting for you
 *   moving    cyan    Run / Jog — motion under command, brand accent
 *   homing    blue    Home — referencing motion; the convention senders share
 *   waiting   amber   Hold / Door / Tool — paused, wants a decision
 *   stopped   red     Alarm — locked, needs recovery
 *   inert     slate   Check / Sleep — powered but not a working state
 *
 * Blue is only ever homing, and purple is only ever Park; before this they
 * collided (the Home state wore Park's colour).
 */

/** grblHAL state (the part before any ':' substate) → text colour class. */
const STATE_COLOR: Record<string, string> = {
  Idle: 'text-ok',
  Run: 'text-brand',
  Jog: 'text-brand',
  Home: 'text-homing',
  Hold: 'text-warn',
  Door: 'text-warn',
  Tool: 'text-warn',
  Alarm: 'text-danger',
  Check: 'text-slate-400',
  Sleep: 'text-slate-400'
}

/** Colour for a raw state string ("Hold:0", "Idle", …). Unknown → muted. */
export function stateColor(state: string | undefined | null): string {
  const base = (state ?? '').split(':')[0]
  return STATE_COLOR[base] ?? 'text-slate-500'
}
