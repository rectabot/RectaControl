import { useEffect, useState } from 'react'
import { RT } from '@shared/grbl'
import { useStore } from '../store'
import { useT } from '../i18n'

/** Overlay toggles (bottom-left of the toolpath) for coolant + the VAC output.
 *  Which buttons show is configured in Settings (store.auxButtons).
 *  MIST = M7, FLOOD = M8 — state follows the controller (manual OR g-code) via the
 *  cached A: accessory field. M9 turns ALL coolant off, so turning one off
 *  re-asserts the other if it was on. VAC = M64/M65 P0 (generic aux output) — no
 *  status readback, so tracked locally.
 *
 *  While a program is RUNNING the M-codes are useless: they are line commands and
 *  queue behind everything already buffered, so coolant the g-code switched on
 *  could not be switched off by hand — you pressed the button and nothing happened
 *  until the job ended. In Run and Hold the realtime toggles do it instead; they
 *  are handled in the receive interrupt, ahead of the queue, and hold until the
 *  program's next M7/M8/M9 takes the output back. */
export function AuxToggles(): JSX.Element {
  const t = useT()
  const connected = useStore((s) => s.connected)
  const accessory = useStore((s) => s.accessory)
  const aux = useStore((s) => s.auxButtons)
  const base = useStore((s) => (s.status?.state ?? '').split(':')[0])
  const jobRunning = useStore((s) => s.job.running)
  const sdRunning = useStore((s) => s.sdRunning)
  const mist = accessory.includes('M')
  const flood = accessory.includes('F')
  const [vac, setVac] = useState(false)

  /** Is there a program between this button and the machine?
   *
   *  Keyed on the JOB, not on the controller's state. A program sitting in `G4`
   *  moves nothing, the planner drains, and grblHAL correctly reports `Idle` — but
   *  the queue is still there and an `M9` still lands behind it. State says what
   *  the motors are doing; the job says whether anything is in the way.
   *
   *  Run and Hold stay in as well, for a program started from somewhere other than
   *  this app (an SD run begun at the panel, or a resumed job). */
  const streaming = jobRunning || sdRunning || base === 'Run' || base === 'Hold'

  const [mistPending, expectMist] = usePendingToggle(mist)
  const [floodPending, expectFlood] = usePendingToggle(flood)

  const toggleMist = (): void => {
    if (streaming) {
      if (mistPending) return // one in flight; see usePendingToggle
      expectMist(!mist)
      return void window.recta.realtime(RT.mistToggle)
    }
    if (mist) {
      window.recta.send('M9') // all coolant off
      if (flood) window.recta.send('M8') // keep flood on
    } else window.recta.send('M7')
  }
  const toggleFlood = (): void => {
    if (streaming) {
      if (floodPending) return
      expectFlood(!flood)
      return void window.recta.realtime(RT.floodToggle)
    }
    if (flood) {
      window.recta.send('M9')
      if (mist) window.recta.send('M7') // keep mist on
    } else window.recta.send('M8')
  }
  // VAC is a generic aux output (M64/M65) and grblHAL has no realtime command for
  // one, so during a job it can only be reached by writing a line. That is safe now
  // — sendLine feeds the same character counting the program does, so the line is
  // metered and its `ok` is not credited to a streamed line — but it is not instant:
  // it takes its turn behind what is already buffered. The button flips straight
  // away because there is no status readback to flip it, so on a slow feed it can
  // lead the real output by a second or two. Mist and flood have realtime bytes and
  // do not wait.
  const toggleVac = (): void => {
    const on = !vac
    setVac(on)
    window.recta.send(on ? 'M64 P0' : 'M65 P0')
  }

  return (
    <div className="flex gap-2">
      {aux.mist && <Chip label="MIST" on={mist} disabled={!connected || mistPending} onClick={toggleMist} />}
      {aux.flood && <Chip label="FLOOD" on={flood} disabled={!connected || floodPending} onClick={toggleFlood} />}
      {/* The tooltip only appears mid-job, where it has something to say: the button
          works, but the output follows a beat later. It rides on a wrapper because
          that is where it started, back when the button was disabled here and a
          disabled button gets no mouse events to show its own title. */}
      {aux.vac && (
        <span title={streaming ? t('ui.aux.vacBusy') : undefined}>
          <Chip label="VAC" on={vac} disabled={!connected} onClick={toggleVac} />
        </span>
      )}
    </div>
  )
}

/** Send one realtime coolant toggle at a time and wait for the machine to confirm it.
 *
 *  grblHAL drains the WHOLE coolant override queue in one pass and only then compares
 *  the result with the current state (protocol.c), so within one pass only the parity
 *  of a burst survives: ten quick presses flip a local flag ten times and change
 *  nothing at all. That is not a broken button, but it looks exactly like one — on
 *  1 Aug it cost an hour of hunting through the firmware before the operator's own log
 *  gave it away, every burst an even number.
 *
 *  So the button holds until the `A:` field comes back carrying the new state, which
 *  is fast: sending a toggle also asks for a status report straight away. The timeout
 *  is only there so a byte lost on the wire cannot latch the button off forever. */
function usePendingToggle(actual: boolean): [boolean, (want: boolean) => void] {
  const [want, setWant] = useState<boolean | null>(null)
  useEffect(() => {
    if (want === null) return
    if (actual === want) {
      setWant(null)
      return
    }
    const timer = setTimeout(() => setWant(null), 1500)
    return () => clearTimeout(timer)
  }, [want, actual])
  return [want !== null, setWant]
}

function Chip({
  label,
  on,
  disabled,
  onClick
}: {
  label: string
  on: boolean
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      // fixed width so all three coolant buttons are identical; label centred.
      className={`flex w-20 items-center justify-center rounded-md border px-3 py-2 text-xs font-semibold backdrop-blur transition disabled:opacity-40 ${
        on
          ? 'border-ok bg-ok/90 text-[#020617] shadow-glow'
          : 'border-border bg-panel/80 text-slate-300 hover:border-brand'
      }`}
    >
      {label}
    </button>
  )
}
