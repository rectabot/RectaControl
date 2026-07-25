import { createPortal } from 'react-dom'
import { RT } from '@shared/grbl'
import { getAlarm, getError, type RecoveryAction } from '@shared/messages'
import { useStore } from '../store'
import { useLang, useT } from '../i18n'

/** The one-tap recovery buttons, wired to the controller. */
function runAction(action: RecoveryAction): void {
  if (action === 'reset') window.recta.realtime(RT.softReset)
  else if (action === 'unlock') window.recta.send('$X')
  else if (action === 'home') window.recta.send('$H')
}

// The three recovery buttons are always shown in this order + colour, matching
// the alarm/error reference table for consistency: Unlock = yellow (warn),
// Home = green (ok), Reset = red (danger).
const ALL_ACTIONS: RecoveryAction[] = ['unlock', 'home', 'reset']
const TONE: Record<RecoveryAction, string> = {
  unlock: 'border-warn text-warn enabled:hover:bg-warn enabled:hover:text-[#020617]',
  home: 'border-ok text-ok enabled:hover:bg-ok enabled:hover:text-[#020617]',
  reset: 'border-danger text-danger enabled:hover:bg-danger enabled:hover:text-white'
}

/** Recovery popup for the active alarm/error. Auto-opens when a new code arrives
 *  (store `recoveryOpen`) and can be re-opened from the status bar. Explains when
 *  it happens + what to do, and offers the applicable recovery buttons
 *  (Unlock $X / Home $H / Reset) wired straight to the machine. */
export function WhatToDo(): JSX.Element | null {
  const t = useT()
  const lang = useLang()
  const alert = useStore((s) => s.alert)
  const open = useStore((s) => s.recoveryOpen)
  const setOpen = useStore((s) => s.setRecoveryOpen)
  const clearAlert = useStore((s) => s.clearAlert)
  const connected = useStore((s) => s.connected)
  const homingEnabled = useStore((s) => s.homingEnabled)
  const base = useStore((s) => (s.status?.state ?? '').split(':')[0])

  if (!alert || !open) return null

  const detail = alert.kind === 'alarm' ? getAlarm(alert.code, lang) : getError(alert.code, lang)
  const prefix = alert.kind === 'alarm' ? 'ALARM' : 'error'
  const badge = alert.kind === 'alarm' ? 'text-danger' : 'text-warn'
  const alarmed = base === 'Alarm'
  const inActions = (a: RecoveryAction): boolean => (detail.actions ?? []).includes(a)
  const hasActions = (detail.actions ?? []).length > 0
  // Recovery is staged to match the machine: while it's locked in Alarm you can
  // only Unlock/Reset ($H would just error:9). Home lights up once the alarm is
  // cleared. So Unlock is the FIRST step when a Home step follows.
  const homeStep = inActions('home') && homingEnabled
  const enabledFor = (a: RecoveryAction): boolean => {
    if (!connected) return false
    if (a === 'unlock') return inActions('unlock') && alarmed
    if (a === 'home') return homeStep && !alarmed
    return inActions('reset') // reset is valid whenever it's the remedy
  }
  const onAction = (a: RecoveryAction): void => {
    runAction(a)
    // Unlock is only step one when a Home step follows — keep the popup open so
    // Home lights up once the alarm clears. Everything else finishes recovery.
    if (a === 'unlock' && homeStep) return
    clearAlert()
  }

  // portal to <body>: the status bar (where this lives) sets `whitespace-nowrap`,
  // which would otherwise inherit into the modal and stop the text from wrapping.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center whitespace-normal bg-black/60 p-6">
      {/* modal — closes ONLY via the ✕ or a recovery action, not a backdrop click,
          so it can't be dismissed by accident while the machine needs attention */}
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        {/* header */}
        <div className="flex items-start gap-3 border-b border-border px-6 py-4">
          <span className={`shrink-0 font-mono text-sm font-bold ${badge}`}>
            {prefix}:{alert.code}
          </span>
          <span className="flex-1 text-sm font-semibold text-slate-100">{detail.title}</span>
          <button className="shrink-0 text-slate-500 hover:text-slate-300" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        {/* body */}
        <div className="space-y-4 px-6 py-5 pr-8 text-[13px] leading-relaxed">
          {detail.cause && (
            <p className="text-slate-400">
              <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {t('ui.errors.cause')}
              </span>
              {detail.cause}
            </p>
          )}
          {detail.recovery && (
            <p className="text-slate-200">
              <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand/80">
                {t('ui.errors.recovery')}
              </span>
              {detail.recovery}
            </p>
          )}
        </div>

        {/* recovery actions — always the same three, but only the one(s) this
            code needs are enabled, so the operator knows exactly what to press */}
        {hasActions && (
          <div className="flex gap-2 border-t border-border px-6 py-3">
            {ALL_ACTIONS.map((a) => (
              <button
                key={a}
                disabled={!enabledFor(a)}
                onClick={() => onAction(a)}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-30 ${TONE[a]}`}
              >
                {t(`ui.errors.act.${a}`)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
