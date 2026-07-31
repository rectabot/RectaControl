import { useState } from 'react'
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

  const toggleMist = (): void => {
    if (streaming) return void window.recta.realtime(RT.mistToggle)
    if (mist) {
      window.recta.send('M9') // all coolant off
      if (flood) window.recta.send('M8') // keep flood on
    } else window.recta.send('M7')
  }
  const toggleFlood = (): void => {
    if (streaming) return void window.recta.realtime(RT.floodToggle)
    if (flood) {
      window.recta.send('M9')
      if (mist) window.recta.send('M7') // keep mist on
    } else window.recta.send('M8')
  }
  const toggleVac = (): void => {
    if (streaming) return // see the disabled state below
    const on = !vac
    setVac(on)
    window.recta.send(on ? 'M64 P0' : 'M65 P0')
  }

  return (
    <div className="flex gap-2">
      {aux.mist && <Chip label="MIST" on={mist} disabled={!connected} onClick={toggleMist} />}
      {aux.flood && <Chip label="FLOOD" on={flood} disabled={!connected} onClick={toggleFlood} />}
      {/* VAC is the one output with no realtime command behind it, so during a job
          it can only be reached by writing a line — and a hand-written line lands
          in grblHAL's receive buffer without the streamer counting it, and its `ok`
          gets credited to a streamed line. Off during a job, therefore: a button
          that quietly endangers the running program is worse than one that says
          "not now". */}
      {/* the reason rides on a wrapper, not the button: a disabled button gets no
          mouse events, so its own `title` never shows the one time it matters */}
      {aux.vac && (
        <span title={streaming ? t('ui.aux.vacBusy') : undefined}>
          <Chip label="VAC" on={vac} disabled={!connected || streaming} onClick={toggleVac} />
        </span>
      )}
    </div>
  )
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
          ? 'border-ok bg-ok/90 text-base shadow-glow'
          : 'border-border bg-panel/80 text-slate-300 hover:border-brand'
      }`}
    >
      {label}
    </button>
  )
}
