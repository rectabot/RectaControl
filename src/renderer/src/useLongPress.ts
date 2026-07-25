import { useRef } from 'react'

/** Pointer handlers that distinguish a long-press from a short tap.
 *  Returns props to spread onto an element. `onLong` fires after `ms` held;
 *  `onShort` fires on release if the long-press hadn't triggered yet. */
export function useLongPress(
  onLong: () => void,
  onShort?: () => void,
  ms = 500
): {
  onPointerDown: () => void
  onPointerUp: () => void
  onPointerLeave: () => void
  onPointerCancel: () => void
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)

  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  return {
    onPointerDown: () => {
      fired.current = false
      timer.current = setTimeout(() => {
        fired.current = true
        onLong()
      }, ms)
    },
    onPointerUp: () => {
      clear()
      if (!fired.current) onShort?.()
    },
    onPointerLeave: clear,
    onPointerCancel: clear
  }
}
