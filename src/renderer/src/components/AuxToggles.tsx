import { useState } from 'react'
import { useStore } from '../store'

/** Overlay toggles (bottom-left of the toolpath) for coolant + the VAC output.
 *  Which buttons show is configured in Settings (store.auxButtons).
 *  MIST = M7, FLOOD = M8 — state follows the controller (manual OR g-code) via the
 *  cached A: accessory field. M9 turns ALL coolant off, so turning one off
 *  re-asserts the other if it was on. VAC = M64/M65 P0 (generic aux output) — no
 *  status readback, so tracked locally. */
export function AuxToggles(): JSX.Element {
  const connected = useStore((s) => s.connected)
  const accessory = useStore((s) => s.accessory)
  const aux = useStore((s) => s.auxButtons)
  const mist = accessory.includes('M')
  const flood = accessory.includes('F')
  const [vac, setVac] = useState(false)

  const toggleMist = (): void => {
    if (mist) {
      window.recta.send('M9') // all coolant off
      if (flood) window.recta.send('M8') // keep flood on
    } else window.recta.send('M7')
  }
  const toggleFlood = (): void => {
    if (flood) {
      window.recta.send('M9')
      if (mist) window.recta.send('M7') // keep mist on
    } else window.recta.send('M8')
  }
  const toggleVac = (): void => {
    const on = !vac
    setVac(on)
    window.recta.send(on ? 'M64 P0' : 'M65 P0')
  }

  return (
    <div className="flex gap-2">
      {aux.mist && <Chip label="MIST" on={mist} disabled={!connected} onClick={toggleMist} />}
      {aux.flood && <Chip label="FLOOD" on={flood} disabled={!connected} onClick={toggleFlood} />}
      {aux.vac && <Chip label="VAC" on={vac} disabled={!connected} onClick={toggleVac} />}
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
