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

/** Park for access: remember the current line + machined fraction, then abort the
 *  stream to Idle so the head can be jogged FREELY (grbl only allows jog in Idle — a
 *  live feed-hold won't). Once the abort settles into Idle, lift Z clear of the work
 *  so the operator can move the head around safely. Resume later rebuilds the job
 *  from the parked line (lift → rapid → plunge). */
export function parkForAccess(): void {
  const s = useStore.getState()
  const base = (s.status?.state ?? '').split(':')[0]
  // require a PAUSED job — aborting a live (Run) motion loses position → alarm
  if (!s.connected || !s.job.running || (base !== 'Hold' && base !== 'Door')) return
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
  if ((id === 'home' || id === 'unlock') && moving) return
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
      window.recta.realtime(RT.feedHold)
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
