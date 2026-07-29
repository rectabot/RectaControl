import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { RT } from '@shared/grbl'
import { getAlarm, getError, type RecoveryAction, type RecoveryStep } from '@shared/messages'
import { useStore, hasLimitPin, ESCAPE_MM } from '../store'
import { useLabel, useLang, useT } from '../i18n'

/** The one-tap recovery buttons, wired to the controller. */
function runAction(action: RecoveryAction): void {
  if (action === 'reset') window.recta.realtime(RT.softReset)
  else if (action === 'unlock') window.recta.send('$X')
  else if (action === 'home') window.recta.send('$H')
  else if (action === 'freeSwitch') useStore.getState().suspendLimits()
}

// Colours are the same everywhere a recovery action appears (popup, reference
// table, Jog panel): Reset = red (danger), Unlock = amber (warn), Home = green
// (ok) — a traffic light, hardest intervention first.
const TONE: Record<RecoveryAction, string> = {
  unlock: 'border-warn text-warn enabled:hover:bg-warn enabled:hover:text-[#020617]',
  home: 'border-ok text-ok enabled:hover:bg-ok enabled:hover:text-[#020617]',
  reset: 'border-danger text-danger enabled:hover:bg-danger enabled:hover:text-white',
  freeSwitch: 'border-warn text-warn enabled:hover:bg-warn enabled:hover:text-[#020617]'
}
// a step done at the machine ("Done") is not a machine command — it stays neutral
const NEUTRAL = 'border-border2 text-slate-200 enabled:hover:border-brand enabled:hover:text-brand'

/** Every action in this dialog wears the same shape and sits in the same row, so a
 *  step change never moves the button out from under the pointer. Two of them side
 *  by side split the row evenly (the direction pair, and Close/Home at the end). */
function ActionBtn({
  tone,
  label,
  onClick,
  disabled,
  title
}: {
  tone: string
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}): JSX.Element {
  return (
    <button
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition disabled:opacity-30 ${tone}`}
    >
      {label}
    </button>
  )
}

/** Recovery popup for the active alarm/error. Auto-opens when a new code arrives
 *  (store `recoveryOpen`) and can be re-opened from the status bar.
 *
 *  It does not just name the remedy — it WALKS the operator through it, ONE STEP
 *  AT A TIME. Only the current step of the code's procedure is on screen, with a
 *  single primary button: the machine command it needs, or "Done" when it is
 *  something to do at the machine. Everything else is small and out of the way —
 *  progress dots, a back link, the optional jump into the Settings page that holds
 *  the fix. A full list of steps would turn a moment of stress into a form to
 *  read; the catalogue (Settings → Errors) is where the whole procedure is studied
 *  at leisure. Steps the machine has already satisfied are skipped automatically.
 *
 *  Guidance must never become a cage: if the procedure is wrong for someone's
 *  machine, Reset (status bar) and Unlock / Home (Jog panel) stay reachable behind
 *  this dialog, so there is no need to duplicate them inside it. */
export function WhatToDo(): JSX.Element | null {
  const t = useT()
  // Machine commands keep their fixed English labels in every language (see
  // useLabel): the operator sees the same Unlock / Home / Reset here, on the Jog
  // panel and in the manual. Only the explaining text follows the language.
  const L = useLabel()
  const lang = useLang()
  const alert = useStore((s) => s.alert)
  const open = useStore((s) => s.recoveryOpen)
  const setOpen = useStore((s) => s.setRecoveryOpen)
  const clearAlert = useStore((s) => s.clearAlert)
  const openSettingsAt = useStore((s) => s.openSettingsAt)
  const connected = useStore((s) => s.connected)
  const resetRequired = useStore((s) => s.resetRequired)
  const homingEnabled = useStore((s) => s.homingEnabled)
  const homed = useStore((s) => s.homed)
  const base = useStore((s) => (s.status?.state ?? '').split(':')[0])
  const limitsSuspended = useStore((s) => s.limitsSuspended != null)
  const restoreLimits = useStore((s) => s.restoreLimits)
  const escapeSwitch = useStore((s) => s.escapeSwitch)
  const pins = useStore((s) => s.status?.pins ?? null)
  const axes = useStore((s) => s.info.axes)
  // $10 bit 10 makes the board append the alarm code to its state (`Alarm:10`),
  // which is the difference between naming this alarm and guessing at it — see the
  // code-0 entry in messages.ts. Read it once when we are here BECAUSE it was off.
  const reportMask = useStore((s) => Number(s.settingValues[10]))
  const substateOff = Number.isFinite(reportMask) && (reportMask & 1024) === 0
  const limitEngaged = hasLimitPin(pins)
  const idle = base === 'Idle' // a jog only goes out from Idle
  // which axes are sitting on a switch, in the machine's own axis order
  const engagedAxes = axes.filter((a) => (pins ?? '').includes(a))
  // how far the operator has walked; reset whenever a new code arrives
  const [advanced, setAdvanced] = useState(0)
  useEffect(() => setAdvanced(0), [alert?.seq])

  // An un-announced alarm (code 0) is the one case where the board's report mask
  // matters to the operator, so ask for it here rather than making them open
  // Settings. Nothing is written — the offer below needs the operator's click.
  const unannounced = alert?.code === 0 && alert.kind === 'alarm'
  useEffect(() => {
    if (unannounced && connected && !Number.isFinite(reportMask)) window.recta.send('$10')
  }, [unannounced, connected, reportMask])

  if (!alert || !open) return null

  const detail = alert.kind === 'alarm' ? getAlarm(alert.code, lang) : getError(alert.code, lang)
  const prefix = alert.kind === 'alarm' ? 'ALARM' : 'error'
  const badge = alert.kind === 'alarm' ? 'text-danger' : 'text-warn'

  // Codes that predate the guided catalogue still have a plain `actions` list —
  // turn each one into a one-line step so every code gets the same treatment.
  const steps: RecoveryStep[] =
    detail.steps ?? (detail.actions ?? []).map((a) => ({ do: a, text: t(`ui.errors.step.${a}`) }))
  // a Home step on a machine that does not home ($22 off) can never run — and,
  // the other way round, a step that only exists BECAUSE $H isn't available is
  // noise on a homing machine (grblHAL's homing drives off a limit switch itself)
  const usable = steps.filter((s) =>
    s.do === 'home' ? homingEnabled : !(s.ifNoHoming && homingEnabled)
  )
  // procedures for grblHAL's CRITICAL alarms open with a Reset, because that is
  // the only thing the controller accepts while it blocks (see store.resetRequired)
  const criticalStart = usable[0]?.do === 'reset'
  // …and until that reset lands, every other command would only answer error:79
  const blocked = (a: RecoveryAction): boolean => resetRequired && a !== 'reset'

  // Steps the machine has already dealt with are skipped, so re-opening the popup
  // mid-recovery lands on the step that is actually left. A leading Reset step is
  // "done" once the controller is out of its blocking loop (`resetRequired` is
  // lifted by the welcome banner) — the operator may have pressed Reset anywhere.
  const satisfied = (s: RecoveryStep | undefined): boolean =>
    !s
      ? false // out of range — never let an index slip take the UI down again
      : // a step tied to an input is done when the INPUT says so (E-stop released,
        // driver fault gone) — never when someone clicks "Done" over a live signal
        s.pin
        ? !(pins ?? '').includes(s.pin)
        : s.do === 'unlock'
      ? !resetRequired && base !== '' && base !== 'Alarm'
      : s.do === 'home'
        ? homed
        : s.do === 'reset'
          ? criticalStart && !resetRequired
          : // freeing the switch is done when the switch says so — not when the
            // button was pressed. The operator still has to jog clear, and the
            // released switch is what moves the procedure on (and re-arms $21).
            s.do === 'freeSwitch'
            ? !limitEngaged
            : false
  // `advanced` belongs to the PREVIOUS code until the reset effect runs — and
  // effects run after the render, so a new alert with a shorter procedure would be
  // walked with a stale index and index past the end. That happened for real: an
  // alarm during a job raises a second code right behind it (the abort's error),
  // the popup re-rendered against the new code with the old position, and reading
  // `usable[4]` of a 2-step procedure took the whole UI down. Clamp here; the
  // effect below is then only a convenience, never load-bearing.
  let cur = Math.min(advanced, usable.length)
  while (cur < usable.length && satisfied(usable[cur])) cur++
  const finished = cur >= usable.length
  // Procedure walked out AND the machine is no longer in Alarm — there is nothing
  // left to say. The store drops the alert on the next status report anyway, so
  // rendering a "recovered" screen here only makes it flash for one poll interval
  // (~200 ms) between the last click and that report. The machine state in the top
  // bar is the confirmation; a window that appears just to be dismissed is not.
  if (finished && base !== 'Alarm') return null
  const step = finished ? null : usable[cur]
  const isLast = cur === usable.length - 1
  // stepping back is offered only where it can actually take effect (a machine-
  // satisfied step would be skipped forward again the moment we render)
  const canGoBack = cur > 0 && !satisfied(usable[cur - 1])

  // Unlock / Home / Reset are the worldwide command set — fixed English, like the
  // Jog panel. "Free the switch" is our own invention, not a grbl command, so it
  // speaks the operator's language.
  const cmdLabel = (a: RecoveryAction): string =>
    a === 'freeSwitch' ? t('ui.errors.act.freeSwitch') : L(`ui.errors.act.${a}`)

  const nextStep = (): void => setAdvanced(cur + 1)
  const onCommand = (a: RecoveryAction, isStep: boolean): void => {
    runAction(a)
    // the command on the last step ends the dialog — the operator has just done the
    // last thing the procedure asks for; another screen would only be in the way
    if (isStep && isLast && a !== 'freeSwitch') close()
    // freeSwitch opens a window instead of completing a step — `satisfied` closes
    // it when the switch releases, so advancing here would skip the jogging.
    else if (isStep && a !== 'freeSwitch') nextStep()
    // The alert belongs to the machine: it is dropped only when the machine really
    // leaves Alarm (the store does that on the state change). Closing here would
    // throw away the explanation while the red state is still on screen.
    else if (base !== 'Alarm') clearAlert()
  }
  // finishing the dialog: drop the alert once the machine is genuinely out of Alarm,
  // otherwise just hide it (the red state must keep its explanation available)
  const close = (): void => {
    if (base === 'Alarm') setOpen(false)
    else clearAlert()
  }
  const onGoto = (section: string): void => {
    nextStep()
    setOpen(false) // Settings renders below this overlay — get out of its way
    openSettingsAt(section)
  }

  // portal to <body>: the status bar (where this lives) sets `whitespace-nowrap`,
  // which would otherwise inherit into the modal and stop the text from wrapping.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center whitespace-normal bg-black/60 p-6">
      {/* modal — closes ONLY via the ✕ or a finished recovery, not a backdrop click,
          so it can't be dismissed by accident while the machine needs attention */}
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        {/* header — code, title, and the why in one muted line. The why lives up
            here (not in the step area) so the body below can stay a fixed size. */}
        <div className="shrink-0 border-b border-border px-6 py-3">
          <div className="flex items-start gap-3">
            <span className={`shrink-0 font-mono text-sm font-bold ${badge}`}>
              {prefix}:{alert.code}
            </span>
            <span className="flex-1 text-sm font-semibold text-slate-100">{detail.title}</span>
            <button className="shrink-0 text-slate-500 hover:text-slate-300" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          {detail.cause && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{detail.cause}</p>
          )}
        </div>

        {/* ONE fixed-height body for every step: the text area scrolls if it has to,
            the action row is pinned to the bottom. Walking the procedure must not
            resize the window or move the button out from under the pointer. */}
        <div className="flex h-[13rem] flex-col px-6 py-4">
          {step ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
              {/* how far along we are — dots only, and only if there is more than one */}
              {usable.length > 1 && (
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-brand/80">
                    {t('ui.errors.stepOf', { n: cur + 1, total: usable.length })}
                  </span>
                  <span className="flex gap-1">
                    {usable.map((_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${
                          i < cur ? 'bg-ok/60' : i === cur ? 'bg-brand' : 'bg-border2'
                        }`}
                      />
                    ))}
                  </span>
                  {canGoBack && (
                    <button
                      className="ml-auto text-[11px] text-slate-500 transition hover:text-slate-300"
                      onClick={() => setAdvanced(cur - 1)}
                    >
                      ← {t('ui.errors.back')}
                    </button>
                  )}
                </div>
              )}

                {/* the one thing to do right now */}
                <p className="text-[14px] leading-relaxed text-slate-100">{step.text}</p>

                {/* live state of the switch rescue — only while limits are actually off */}
                {step.do === 'freeSwitch' && limitsSuspended && (
                  <p className="mt-2 flex items-center gap-2 text-[12px] font-semibold text-warn">
                    ⚠ {t('ui.errors.limitsOff')}
                    <button
                      className="font-normal text-slate-400 underline transition hover:text-slate-200"
                      onClick={restoreLimits}
                    >
                      {t('ui.errors.limitsRestore')}
                    </button>
                  </p>
                )}
                {step.do === 'freeSwitch' && (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t('ui.errors.escapeHint')}</p>
                )}
              </div>

              {/* the action row — ALWAYS here, same place on every step. One button
                  normally; two side by side where the choice itself is the action
                  (which way off the switch), and on the LAST step where Close sits
                  next to it: that screen is the end of the road, so pressing either
                  finishes the dialog. No extra "recovered" screen appears behind a
                  click the operator already made. */}
              <div className="mt-3 flex shrink-0 gap-2">
                {/* Close rides along on the last step — except when that step is a
                    Reset the controller is demanding: there is nothing to choose
                    between, and offering an exit would only park the operator in
                    front of a machine that accepts nothing else. */}
                {isLast && !(step.do === 'reset' && resetRequired) && (
                  <ActionBtn tone={NEUTRAL} onClick={close} label={t('ui.errors.close')} />
                )}
                {step.do === 'freeSwitch' ? (
                  engagedAxes.length ? (
                    engagedAxes.flatMap((ax) =>
                      ([-1, 1] as const).map((dir) => (
                        <ActionBtn
                          key={`${ax}${dir}`}
                          tone={TONE.freeSwitch}
                          disabled={!connected || !idle}
                          title={!idle ? t('ui.errors.escapeWait') : undefined}
                          onClick={() => escapeSwitch(ax, dir)}
                          label={`${ax} ${dir > 0 ? '+' : '−'}${ESCAPE_MM}`}
                        />
                      ))
                    )
                  ) : (
                    <ActionBtn tone={NEUTRAL} onClick={nextStep} label={t('ui.errors.stepDone')} />
                  )
                ) : step.do !== 'manual' ? (
                  <ActionBtn
                    tone={TONE[step.do as RecoveryAction]}
                    disabled={!connected || blocked(step.do as RecoveryAction)}
                    title={blocked(step.do as RecoveryAction) ? t('ui.errors.resetFirst') : undefined}
                    onClick={() => onCommand(step.do as RecoveryAction, true)}
                    label={cmdLabel(step.do as RecoveryAction)}
                  />
                ) : step.pin ? (
                  // the machine is the judge here — this only ever renders while the
                  // input is still asserted, and clearing it advances the step
                  <ActionBtn tone={NEUTRAL} disabled onClick={() => {}} label={t('ui.errors.waiting')} />
                ) : (
                  <ActionBtn
                    tone={NEUTRAL}
                    onClick={isLast ? close : nextStep}
                    label={t('ui.errors.stepDone')}
                  />
                )}
              </div>

              {step.goto && (
                <button
                  className="mt-1.5 shrink-0 text-[11px] text-brand/70 transition hover:text-brand"
                  onClick={() => onGoto(step.goto!)}
                >
                  {t('ui.errors.openSettings')}
                </button>
              )}

              {/* Why this alarm has no name, and the one click that fixes it for
                  every future one. Offered, never done quietly: it is the operator's
                  machine setting, and it is written only from here, with the value
                  read back off the board first so nothing else in $10 is lost. */}
              {unannounced && substateOff && (
                <p className="mt-1.5 shrink-0 text-[11px] leading-snug text-slate-500">
                  {t('ui.errors.substateWhy')}{' '}
                  <button
                    className="text-brand/80 underline transition hover:text-brand disabled:opacity-40"
                    disabled={!connected}
                    onClick={() => window.recta.send(`$10=${reportMask | 1024}`)}
                  >
                    {t('ui.errors.substateFix')}
                  </button>
                </p>
              )}
            </>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <p className={`text-[14px] leading-relaxed ${base === 'Alarm' ? 'text-slate-200' : 'text-ok'}`}>
                  {usable.length > 0
                    ? base === 'Alarm'
                      ? t('ui.errors.stillAlarm')
                      : `✓ ${t('ui.errors.recovered')}`
                    : detail.recovery}
                </p>
              </div>
              {/* Close, and Home — offered whether or not the machine says it is
                  homed. Hitting a limit switch means steps were probably lost, so
                  the reference is suspect exactly when the machine claims to have
                  one; the operator decides, and either button ends the dialog. */}
              <div className="mt-3 flex shrink-0 gap-2">
                <ActionBtn tone={NEUTRAL} onClick={() => close()} label={t('ui.errors.close')} />
                {homingEnabled && (
                  <ActionBtn
                    tone={TONE.home}
                    disabled={!connected || blocked('home')}
                    onClick={() => {
                      runAction('home')
                      close()
                    }}
                    label={cmdLabel('home')}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
