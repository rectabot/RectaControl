/**
 * Runtime side of the control actions — turns an action id into the actual
 * controller command(s). Shared by the keyboard and gamepad layers.
 */
import { RT } from '@shared/grbl'
import { useStore } from './store'
import { fromDisplay } from './units'
import { clampContinuousJog } from './jogLimits'
import { rotateGcode } from './gcodeRotate'
import { buildResume } from './toolpath'

const CONT_DIST = 1000 // mm — hold-jog distance; cancelled on release
const PARK_SAFE_Z = 5 // mm — safe WORK-Z clearance: retract to here on park, and
// return via here on resume (buildResume lifts to this absolute Z before rapiding)

/** Pause the program, parking the tool clear of the work when the machine can do it.
 *
 *  A plain feed hold stops with the tool still down in the cut and the spindle still
 *  turning against it. grblHAL can lift it out and put it back by itself — but only
 *  through the door command, which is the one thing that arms the parking motion. It
 *  then retracts by $56, powers down, rapids to $58, and Cycle Start walks all of that
 *  backwards and carries on with the program. Nothing is torn down, so there is no
 *  rebuilt preamble and no re-entry to get wrong.
 *
 *  It falls back to a plain hold unless all of the following hold, because getting
 *  this wrong gives the operator a pause they cannot undo — or a moving machine:
 *   • parking must be on ($41 bit 0), and not the "deactivate on init" variant
 *     (bit 1), which leaves it off until an M56 we cannot see has switched it on.
 *     Without a parking motion the door command stops the machine and lifts nothing,
 *     which is the same tool in the same cut plus a door state to get out of;
 *   • the door input must read closed. grblHAL refuses to leave the door state while
 *     the signal says ajar (protocol.c), so on a machine whose $14 has that input
 *     inverted the wrong way — the 30 Jul 2026 fault, and the factory default — Pause
 *     would stop the job for good. A pause is not the place to discover that;
 *   • the machine must be homed. The park target ($58) is a MACHINE coordinate, and
 *     on an unreferenced machine that is measured from wherever it happened to power
 *     up. The motion only ever travels away from the work, so it cannot plunge — but
 *     it can drive Z into its top stop, and with no reference there are no soft
 *     limits to catch it. */
export function parkOnPause(): boolean {
  const s = useStore.getState()
  const enabled = Number(s.settingValues[41])
  if (!Number.isFinite(enabled) || (enabled & 1) === 0 || (enabled & 2) !== 0) return false
  return s.homed && !(s.status?.pins ?? '').includes('D')
}

export function pauseProgram(): void {
  const s = useStore.getState()
  const park = parkOnPause()
  // An SD / external run has no app-side stream to pause — just the realtime byte.
  if (s.job.running) window.recta.pauseJob(park)
  else window.recta.realtime(park ? RT.safetyDoor : RT.feedHold)
}

/** Has a paused machine actually come to rest?
 *
 *  Anything that soft-resets the controller has to know: a reset while the machine
 *  is moving loses the position, and grblHAL answers with ALARM:3 — an unlock and a
 *  re-home to get back from, for a button the operator was invited to press.
 *
 *  Two conditions, and it needs both.
 *
 *  The state says the machine is PAUSED and not, say, mid-program. The sub-state
 *  after the colon narrows it — `Hold:1` is still decelerating, `Door:2` is running
 *  the park retract, `Door:4` is restoring from it — so those are out.
 *
 *  But the sub-state alone is not enough, and this is the part worth remembering:
 *  `Door:0` means "parked, door closed", and grblHAL reports it while the FAST park
 *  to $58 is still running. Gating on it let the button light up mid-flight, and
 *  Filip caught ALARM:3 on the machine within minutes — the slow leg was safe, the
 *  fast leg was not. So the real answer comes from `settled`, which is measured from
 *  the reported position rather than read off a state machine. Position is the one
 *  thing that cannot be wrong about whether something moved. */
export function atRest(state: string | undefined | null, settled: boolean): boolean {
  if (!settled) return false
  const [base, sub] = (state ?? '').split(':')
  if (base === 'Hold') return sub === '0'
  if (base === 'Door') return sub === '0' || sub === '1'
  return false
}

/** Park for access: remember the current line + machined fraction, then abort the
 *  stream to Idle so the head can be jogged FREELY (grbl only allows jog in Idle — a
 *  live feed-hold won't). Once the abort settles into Idle, lift Z clear of the work
 *  so the operator can move the head around safely. Resume later rebuilds the job
 *  from the parked line (lift → rapid → plunge). */
export function parkForAccess(): void {
  const s = useStore.getState()
  // require a paused job that has STOPPED MOVING — aborting mid-motion loses the
  // position and alarms, and a paused machine is still moving while it decelerates
  // or runs a park retract. See atRest().
  if (!s.connected || !s.job.running || !atRest(s.status?.state, s.settled)) return
  s.setParkLine(Math.max(0, s.activeLine))
  s.setParkProgress(s.jobProgress) // freeze the grey "already cut" fraction
  s.setParked(true)
  window.recta.stopJob() // clean abort from Hold → Idle (position + offsets kept)
  parkOrLiftOnIdle(PARK_SAFE_Z) // once Idle, go to the saved park spot (or just lift)
}

/** After a Park abort, once the machine settles into Idle either:
 *   • go to the SAVED park position — full Z retract (G53 Z0) then G30 (the stored
 *     predefined position) — when one has been set AND the machine is homed (G30 is
 *     in machine coords, so it needs a valid reference); or
 *   • just retract Z straight up to a safe WORK-Z clearance so the head is out of the
 *     material before a MANUAL jog (upward-only: from a Z-20 pocket that's a real
 *     ~25 mm lift; never plunges if already clear).
 *  One-shot: fires on the first Idle then unsubscribes; a timeout guards the case
 *  where the reset lands in Alarm (never Idle) so we don't leak the subscription. */
function parkOrLiftOnIdle(safeWorkZ: number): void {
  let done = false
  const feed = 800
  const finish = (): void => {
    if (done) return
    done = true
    unsub()
    clearTimeout(timer)
  }
  const unsub = useStore.subscribe((st) => {
    const base = (st.status?.state ?? '').split(':')[0]
    if (base !== 'Idle') return
    if (st.parkPos && st.homed) {
      // retract Z fully to the machine top FIRST (so XY travel can't drag through the
      // part), then rapid to the saved park XY in machine coords (G53). Z is left at
      // the top — the park spot is a head-up tool-change position.
      const [px, py] = st.parkPos
      window.recta.send('G53 G0 Z0')
      window.recta.send(`G53 G0 X${Number(px.toFixed(3))} Y${Number(py.toFixed(3))}`)
    } else {
      // No saved park spot, or the machine isn't homed (G53 coords wouldn't be valid),
      // so just lift Z for a manual jog. Explain WHY when a park position IS saved but
      // homing is missing — otherwise "Park only lifts Z" looks broken.
      if (st.parkPos && !st.homed) {
        useStore
          .getState()
          .pushConsole('* Park: machine not homed — home it ($H) to use the saved park position. Lifting Z for a manual jog for now.')
      } else if (!st.parkPos) {
        useStore
          .getState()
          .pushConsole('* Park: no park position saved (Offsets ⊞ → "Set" on the G30 row). Lifting Z for a manual jog for now.')
      }
      const wz = st.status?.wpos?.[2]
      const dz = wz != null ? safeWorkZ - wz : safeWorkZ // distance up to the safe height
      // a jog (not G-code): valid only in Idle, leaves modal state untouched, and is
      // auto-clamped to remaining travel when soft limits are on. Only ever lift UP.
      if (dz > 0.01) window.recta.send(`$J=G91 G21 Z${Number(dz.toFixed(3))} F${feed}`)
    }
    finish()
  })
  const timer = setTimeout(finish, 6000)
}

/** Resume from a park: return to the stopped line and continue, restoring modal
 *  state via the buildResume preamble (units/distance/spindle/coolant + lift/rapid/
 *  plunge). Mirrors the "From Line" flow, seeded at the parked line. */
export function resumeFromPark(): void {
  const s = useStore.getState()
  if (!s.connected || !s.parked || !s.gcode) return
  const plan = buildResume(s.gcode, s.parkLine, PARK_SAFE_Z)
  // seed the tracker's cursor at the parked line so the highlight/progress/grey
  // continue from there (else the forward-only window stalls near the start)
  s.setResumeLine(s.parkLine)
  window.recta.startJob(rotateGcode(plan.gcode, s.rotationDeg), {
    fileLine: s.parkLine,
    preambleLines: plan.preambleLines
  })
  s.setParked(false)
  s.setParkLine(-1)
}

/** Go to the saved park position from Idle (no job running) — a plain "move the head
 *  to the park / tool-change spot" for setups and tool changes. Retract Z to the
 *  machine top first, then rapid to the saved park XY (G53). No abort / resume state
 *  since there's no job to return to. Needs a saved park position and a homed machine. */
export function goToPark(): void {
  const s = useStore.getState()
  const base = (s.status?.state ?? '').split(':')[0]
  if (!s.connected || base !== 'Idle' || s.job.running || s.sdRunning || !s.homed || !s.parkPos) return
  const [px, py] = s.parkPos
  window.recta.send('G53 G0 Z0')
  window.recta.send(`G53 G0 X${Number(px.toFixed(3))} Y${Number(py.toFixed(3))}`)
}

/** Start a jog for an axis/direction, honouring the Hold/Step mode + feed/step.
 *  Returns true if a jog was actually sent — callers use this to decide whether a
 *  matching cancel is owed on release (a blocked jog must NOT be "cancelled", or
 *  the jog-cancel realtime byte would disturb a running program). */
export function startJog(axis: string, dir: number): boolean {
  const s = useStore.getState()
  if (!s.connected) return false
  // jog is only accepted from Idle / Jog — never mid-program, Hold, Home or Alarm.
  // Keyboard/gamepad bypass the on-screen buttons, so guard here too. `sdRunning`
  // latches SD/external runs (no job.running) so a key can't slip in either.
  const base = (s.status?.state ?? '').split(':')[0]
  if (s.job.running || s.sdRunning || (base !== 'Idle' && base !== 'Jog')) return false
  const { mode, feed, step } = s.controls
  const f = Math.round(fromDisplay(feed || 1000, s.units))
  if (mode === 'hold') {
    // clamp the continuous move to remaining travel only when soft limits are
    // enforced (homed + $20 on) — exactly when grblHAL would reject it (error:15)
    const dist =
      s.homed && s.softLimits
        ? clampContinuousJog(
            [{ a: axis, s: dir }],
            s.info.axes,
            s.status?.mpos ?? null,
            s.travel,
            s.homingDirMask,
            CONT_DIST
          )
        : CONT_DIST
    if (dist <= 0) return false // at the soft-limit boundary already
    window.recta.send(`$J=G91 G21 ${axis}${dir * dist} F${f}`)
  } else {
    window.recta.jog(axis, fromDisplay(step * dir, s.units), f)
  }
  return true
}

/** Cancel an in-progress (hold-mode) jog. Defensive: NEVER emit the jog-cancel
 *  realtime byte while a program is active — grblHAL would treat it as a feed
 *  hold and stop the job (after the buffered blocks drain, ~seconds later). Only
 *  a genuine jog (machine in Idle/Jog, no program) may be cancelled. */
export function cancelJog(): void {
  const s = useStore.getState()
  if (!s.connected) return
  const base = (s.status?.state ?? '').split(':')[0]
  if (s.job.running || s.sdRunning || base === 'Run' || base === 'Hold' || base === 'Door') return
  window.recta.realtime(RT.jogCancel)
}

/** Run a momentary action (everything that isn't a jog). */
export function runControlAction(id: string): void {
  const s = useStore.getState()
  if (!s.connected) return
  const base = (s.status?.state ?? '').split(':')[0]
  const acc = s.accessory ?? ''

  // Guard state-sensitive actions so a stray key/button can't corrupt a running
  // job (hold / start / stop stay live — they're the pause & safety controls):
  //  - home/unlock: fine from Idle or Alarm, but not while moving / streaming.
  //  - zero* / spindle / coolant: Idle-only (mid-job they'd inject into the stream).
  const moving = s.job.running || s.sdRunning || ['Run', 'Jog', 'Hold', 'Home', 'Door'].includes(base)
  // …and while a critical event blocks the controller, $X/$H only answer error:79
  if ((id === 'home' || id === 'unlock') && (moving || s.resetRequired)) return
  // never start a program on a machine whose hard limits are suspended for a
  // switch rescue (the keyboard/gamepad path must respect the same rule as the UI)
  if (id === 'start' && s.limitsSuspended != null && !s.job.paused) return
  if (
    ['zeroX', 'zeroY', 'zeroZ', 'zeroAll', 'spindle', 'flood', 'mist'].includes(id) &&
    (s.job.running || s.sdRunning || base !== 'Idle')
  )
    return

  switch (id) {
    case 'home':
      window.recta.send('$H')
      break
    case 'unlock':
      window.recta.send('$X')
      break
    case 'hold':
      pauseProgram() // same parking pause the button gives, from the key/pad too
      break
    case 'start':
      if (base === 'Hold' || base === 'Door') window.recta.realtime(RT.resume)
      else if (s.gcode && base === 'Idle') {
        s.setResumeLine(-1)
        s.setParked(false) // a fresh run cancels any pending park/resume
        s.setParkProgress(0) // and clears the frozen grey fraction
        window.recta.startJob(rotateGcode(s.gcode, s.rotationDeg))
      } else window.recta.realtime(RT.resume)
      break
    case 'stop':
      s.setParked(false) // a full stop abandons any pending park…
      s.setParkProgress(0) // …and clears the frozen grey fraction
      window.recta.stopJob()
      break
    case 'zeroX':
      window.recta.send('G10 L20 P0 X0')
      break
    case 'zeroY':
      window.recta.send('G10 L20 P0 Y0')
      break
    case 'zeroZ':
      window.recta.send('G10 L20 P0 Z0')
      break
    case 'zeroAll':
      window.recta.send('G10 L20 P0 X0 Y0 Z0')
      break
    case 'spindle':
      window.recta.send(/[SC]/.test(acc) ? 'M5' : 'M3')
      break
    case 'flood':
      window.recta.send(acc.includes('F') ? 'M9' : 'M8')
      break
    case 'mist':
      window.recta.send(acc.includes('M') ? 'M9' : 'M7')
      break
  }
}
