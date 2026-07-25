/**
 * Control action registry — the vocabulary of things the machine can do from a
 * keyboard key or a gamepad button. The Controls settings render one row per
 * action with an editable Keyboard + Gamepad binding; the keyboard/gamepad
 * runtimes look actions up by their bound key/button. Pure data — no store or
 * DOM imports — so both the store and the runtimes can share it freely.
 */

export type ActionKind = 'jog' | 'momentary'
export type ActionGroup = 'jog' | 'program' | 'zero' | 'aux'

export interface ControlAction {
  id: string
  labelKey: string
  kind: ActionKind
  group: ActionGroup
  axis?: string // jog only
  dir?: number // jog only (+1 / -1)
}

const jog = (id: string, axis: string, dir: number): ControlAction => ({
  id,
  labelKey: `ui.controls.action.${id}`,
  kind: 'jog',
  group: 'jog',
  axis,
  dir
})
const act = (id: string, group: ActionGroup): ControlAction => ({
  id,
  labelKey: `ui.controls.action.${id}`,
  kind: 'momentary',
  group
})

export const ACTIONS: ControlAction[] = [
  jog('jogXPlus', 'X', 1),
  jog('jogXMinus', 'X', -1),
  jog('jogYPlus', 'Y', 1),
  jog('jogYMinus', 'Y', -1),
  jog('jogZPlus', 'Z', 1),
  jog('jogZMinus', 'Z', -1),
  jog('jogAPlus', 'A', 1),
  jog('jogAMinus', 'A', -1),
  act('home', 'program'),
  act('unlock', 'program'),
  act('hold', 'program'),
  act('start', 'program'),
  act('stop', 'program'),
  act('zeroX', 'zero'),
  act('zeroY', 'zero'),
  act('zeroZ', 'zero'),
  act('zeroAll', 'zero'),
  act('spindle', 'aux'),
  act('flood', 'aux'),
  act('mist', 'aux')
]

export const ACTION_GROUPS: ActionGroup[] = ['jog', 'program', 'zero', 'aux']

export interface Binding {
  key?: string
  pad?: number
}

/** Sensible out-of-the-box keyboard defaults; gamepad starts unbound. */
export const DEFAULT_BINDINGS: Record<string, Binding> = {
  jogXPlus: { key: 'ArrowRight' },
  jogXMinus: { key: 'ArrowLeft' },
  jogYPlus: { key: 'ArrowUp' },
  jogYMinus: { key: 'ArrowDown' },
  jogZPlus: { key: 'PageUp' },
  jogZMinus: { key: 'PageDown' },
  home: { key: 'h' },
  unlock: { key: 'u' },
  hold: { key: ' ' },
  start: { key: 'Enter' },
  stop: { key: 'Escape' }
}

/** Friendly label for a captured keyboard key. */
export function keyLabel(key?: string): string {
  if (!key) return '—'
  const map: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Enter: '↵',
    PageUp: 'PgUp',
    PageDown: 'PgDn'
  }
  return map[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

/** Reverse-lookup: which action is bound to this keyboard key / pad button. */
export function actionForKey(bindings: Record<string, Binding>, key: string): string | undefined {
  return ACTIONS.find((a) => bindings[a.id]?.key === key)?.id
}
export function actionForPad(bindings: Record<string, Binding>, pad: number): string | undefined {
  return ACTIONS.find((a) => bindings[a.id]?.pad === pad)?.id
}
