import { useEffect } from 'react'
import { ACTIONS, actionForPad } from './controls'
import { runControlAction, startJog, cancelJog } from './controlActions'
import { useStore } from './store'

/**
 * Gamepad control layer (Controls settings). Polls the Web Gamepad API and fires
 * the action bound to each button — momentary buttons on press, jog buttons held
 * (continuous) in Hold mode. Button→action mapping comes from the user's
 * bindings. Mounted once from <App/>; renders nothing.
 */
export function useGamepadControls(): void {
  useEffect(() => {
    let raf = 0
    const prev: boolean[] = [] // last frame's pressed state, per button index
    const held: boolean[] = [] // jog buttons currently holding a continuous jog

    const firstPad = (): Gamepad | null => {
      const pads = navigator.getGamepads?.() ?? []
      for (const p of pads) if (p) return p
      return null
    }

    const tick = (): void => {
      const cfg = useStore.getState().controls
      const pad = cfg.gamepad ? firstPad() : null
      if (pad) {
        for (let i = 0; i < pad.buttons.length; i++) {
          const now = pad.buttons[i].pressed
          const was = prev[i] ?? false
          if (now && !was) {
            const id = actionForPad(cfg.bindings, i)
            const a = id ? ACTIONS.find((x) => x.id === id) : undefined
            if (a?.kind === 'jog') {
              // only track as held (→ cancel on release) if the jog actually
              // started; a blocked jog must not later fire a jog-cancel that
              // would disturb a running program.
              const sent = startJog(a.axis!, a.dir!)
              if (sent && cfg.mode === 'hold') held[i] = true
            } else if (a) {
              runControlAction(a.id)
            }
          } else if (!now && was && held[i]) {
            cancelJog()
            held[i] = false
          }
          prev[i] = now
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}
