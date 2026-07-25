import { useStore } from '../store'
import { RT } from '@shared/grbl'
import { getAlarm, getError } from '@shared/messages'
import { useLang, useT, useLabel } from '../i18n'
import { WhatToDo } from './WhatToDo'
import { fmtDuration } from '../format'

// grblHAL Pn: letters → label + accent when triggered.
// X/Y/Z = limits, P = probe, D = door, H = hold, S = cycle-start,
// R = soft-reset, E = e-stop (grblHAL). E-Stop chip matches E or R.
// order mirrors the physical inputs on the RectaBot board:
// limits X Y Z A B  |  control E-Stop Probe Start Hold Door
const CHIPS: Array<{ letters: string[]; label: string; lit: string }> = [
  { letters: ['X'], label: 'X', lit: 'bg-danger text-white' },
  { letters: ['Y'], label: 'Y', lit: 'bg-danger text-white' },
  { letters: ['Z'], label: 'Z', lit: 'bg-danger text-white' },
  { letters: ['A'], label: 'A', lit: 'bg-danger text-white' },
  { letters: ['B'], label: 'B', lit: 'bg-danger text-white' },
  { letters: ['E', 'R'], label: 'E-Stop', lit: 'bg-danger text-white' },
  // NB: use an explicit dark colour, not `text-base` — in Tailwind `text-base` is a
  // FONT SIZE (1rem), which enlarged the chip when lit (limits used text-white, so
  // only these four grew). `text-[#020617]` is the dark-on-bright text used elsewhere.
  { letters: ['P'], label: 'Probe', lit: 'bg-brand text-[#020617]' },
  { letters: ['S'], label: 'Start', lit: 'bg-ok text-[#020617]' },
  { letters: ['H'], label: 'Hold', lit: 'bg-warn text-[#020617]' },
  { letters: ['D'], label: 'Door', lit: 'bg-warn text-[#020617]' }
]

export function StatusBar(): JSX.Element {
  const t = useT()
  const L = useLabel()
  const connected = useStore((s) => s.connected)
  const pins = useStore((s) => s.status?.pins ?? '')
  const info = useStore((s) => s.info)
  const message = useStore((s) => s.message)
  const clearMessage = useStore((s) => s.clearMessage)
  const alert = useStore((s) => s.alert)
  const clearAlert = useStore((s) => s.clearAlert)
  const setRecoveryOpen = useStore((s) => s.setRecoveryOpen)
  const lang = useLang()
  // the persistent alert (survives the reset banner) drives the footer text +
  // the "what do I do?" button; fall back to the transient message otherwise
  const alertDetail = alert
    ? alert.kind === 'alarm'
      ? getAlarm(alert.code, lang)
      : getError(alert.code, lang)
    : null
  const alertText = alert
    ? `${alert.kind === 'alarm' ? 'ALARM' : 'error'}:${alert.code} — ${alertDetail!.title}`
    : null

  return (
    <div className="flex h-9 shrink-0 flex-nowrap items-center gap-3 overflow-hidden whitespace-nowrap rounded-lg border border-border bg-panel px-4 text-sm">
      {/* live input status */}
      <div className="flex shrink-0 items-center gap-1">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">{L('ui.status.lim')}</span>
        {CHIPS.map((c, i) => {
          const active = connected && c.letters.some((l) => pins.includes(l))
          return (
            <span key={c.label}>
              {i === 5 && <span className="mx-1 text-border2">|</span>}
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
                  active ? c.lit : 'bg-panel2 text-slate-600'
                }`}
                title={active ? t('ui.status.triggered', { label: c.label }) : c.label}
              >
                {c.label}
              </span>
            </span>
          )
        })}
        <span
          className="ml-1 inline-block w-28 truncate font-mono text-[10px] text-slate-600"
          title={t('ui.status.pnTitle')}
        >
          Pn:{pins || '–'}
        </span>
      </div>

      {(alert || message) && (
        <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs text-danger">
          <span className="min-w-0 truncate">{alertText ?? message}</span>
          {alert && (
            <button
              onClick={() => setRecoveryOpen(true)}
              className="shrink-0 rounded border border-brand/50 px-2 py-0.5 text-[11px] text-brand transition hover:bg-brand hover:text-[#020617]"
            >
              {t('ui.errors.whatToDo')}
            </button>
          )}
          <button
            className="shrink-0 text-slate-500 hover:text-slate-300"
            onClick={alert ? clearAlert : clearMessage}
          >
            ✕
          </button>
        </span>
      )}

      {/* recovery popup — auto-opens on a new alarm/error, re-openable above */}
      <WhatToDo />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <JobTimer />
        {/* Unlock/Home live in the Jog panel's action column; Reset stays here
            next to the E-Stop/limit status where the eye goes on an alarm. */}
        <button
          className="rounded-md border border-danger px-3 py-0.5 text-xs text-danger transition hover:bg-danger hover:text-white disabled:opacity-40"
          disabled={!connected}
          onClick={() => window.recta.realtime(RT.softReset)}
        >
          {L('ui.status.reset')}
        </button>
        {info.version && (
          <span className="ml-1 font-mono text-[10px] text-slate-500">grblHAL {info.version}</span>
        )}
      </div>
    </div>
  )
}

/** Footer job stopwatch. While a program runs it counts up (⏱ elapsed) and, if
 *  this program has been run before, counts DOWN the remaining time from that real
 *  run. When idle it shows how long the last run took, or — for a freshly loaded
 *  program with a known time — an estimate. */
function JobTimer(): JSX.Element | null {
  const t = useT()
  const running = useStore((s) => s.job.running)
  const elapsedMs = useStore((s) => s.job.elapsedMs)
  const filename = useStore((s) => s.filename)
  const runTimes = useStore((s) => s.runTimes)
  const lastRunMs = useStore((s) => s.lastRunMs)

  const prevMs = filename ? runTimes[filename] : undefined

  if (running) {
    const remain = prevMs !== undefined ? Math.max(0, prevMs - elapsedMs) : null
    return (
      <span
        className="flex items-center gap-1.5 rounded-md bg-panel2 px-2 py-0.5 font-mono text-xs text-brand"
        title={t('ui.time.elapsedTitle')}
      >
        <span className="animate-pulse">⏱</span>
        <span>{fmtDuration(elapsedMs)}</span>
        {remain !== null && <span className="text-slate-500">· {t('ui.time.left', { time: fmtDuration(remain) })}</span>}
      </span>
    )
  }

  // just finished this session → show the real time it took
  if (lastRunMs !== null) {
    return (
      <span className="flex items-center gap-1.5 rounded-md bg-panel2 px-2 py-0.5 font-mono text-xs text-ok">
        ✓ {t('ui.time.done', { time: fmtDuration(lastRunMs) })}
      </span>
    )
  }

  // idle, program loaded and previously timed → show the expected run time
  if (prevMs !== undefined) {
    return (
      <span
        className="flex items-center gap-1.5 rounded-md bg-panel2 px-2 py-0.5 font-mono text-xs text-slate-400"
        title={t('ui.time.estTitle')}
      >
        ⏱ {t('ui.time.est', { time: fmtDuration(prevMs) })}
      </span>
    )
  }

  return null
}
