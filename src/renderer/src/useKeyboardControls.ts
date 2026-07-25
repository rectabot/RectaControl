import { useEffect } from 'react'
import { ACTIONS, actionForKey } from './controls'
import { runControlAction, startJog, cancelJog } from './controlActions'
import { useStore } from './store'

/** True while focus is in a text field, so shortcuts never fire mid-typing. */
function typing(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/**
 * Global keyboard control layer (Controls settings). Looks the pressed key up in
 * the user's bindings and runs the matching action — jog keys are held
 * (continuous) in Hold mode, everything else fires on press. Mounted once from
 * <App/>; renders nothing.
 */
export function useKeyboardControls(): void {
  useEffect(() => {
    // the jog key currently held (hold mode), so we cancel on its release
    let activeJog: string | null = null

    const onKeyDown = (e: KeyboardEvent): void => {
      const cfg = useStore.getState().controls
      if (!cfg.keyboard || typing(e.target)) return

      const id = actionForKey(cfg.bindings, e.key)
      if (!id) return
      const a = ACTIONS.find((x) => x.id === id)
      if (!a) return
      e.preventDefault()

      if (a.kind === 'jog') {
        if (cfg.mode === 'hold') {
          if (e.repeat || activeJog) return // one continuous axis at a time
          // only mark the axis active (→ cancel owed on release) if the jog was
          // actually sent; a blocked jog must not trigger a jog-cancel that would
          // disturb a running program.
          if (startJog(a.axis!, a.dir!)) activeJog = e.key
        } else if (!e.repeat) {
          startJog(a.axis!, a.dir!)
        }
      } else if (!e.repeat) {
        runControlAction(a.id)
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (activeJog === e.key) {
        cancelJog()
        activeJog = null
      }
    }

    // key-up can be missed if focus leaves mid-hold → stop the jog defensively
    const onBlur = (): void => {
      if (activeJog) {
        cancelJog()
        activeJog = null
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
