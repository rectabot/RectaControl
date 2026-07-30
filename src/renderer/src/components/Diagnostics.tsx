import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import type { ProblemReport } from '@shared/types'

/** Settings → System → Diagnostics.
 *
 *  The half of support that has to exist before the first customer does: the log
 *  the app keeps on disk, and a one-click package of everything someone would
 *  otherwise have to be talked through collecting.
 *
 *  The report is written locally and revealed in the file explorer — it is never
 *  uploaded. That is a deliberate choice, not a missing feature: a log carries the
 *  names of the operator's programs, and the contents list below is shown so they
 *  can see exactly what they would be attaching before they attach it.
 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function Diagnostics(): JSX.Element {
  const t = useT()
  const connected = useStore((s) => s.connected)
  const machineBusy = useStore((s) => s.job.running || s.sdRunning)
  const startPinTest = useStore((s) => s.startPinTest)
  const openSettingsAt = useStore((s) => s.openSettingsAt)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ProblemReport | null>(null)
  const [failed, setFailed] = useState(false)

  const build = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      setReport(await window.recta.buildReport(note))
    } catch {
      setFailed(true)
      setReport(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* ── the log ───────────────────────────────────────────────────────── */}
      <h3 className="font-display text-xs font-bold uppercase tracking-wider text-brand">{t('ui.diag.logTitle')}</h3>
      <p className="text-[11px] leading-snug text-slate-500">{t('ui.diag.logDesc')}</p>
      <div>
        <button className="btn h-9" onClick={() => window.recta.logReveal()}>
          {t('ui.diag.openLogs')}
        </button>
      </div>

      {/* ── live input test ───────────────────────────────────────────────── */}
      <div className="mt-2 flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="font-display text-xs font-bold uppercase tracking-wider text-brand">{t('ui.diag.pinTitle')}</h3>
        <p className="text-[11px] leading-snug text-slate-500">{t('ui.diag.pinDesc')}</p>
        <div className="flex items-center gap-2">
          <button
            className="btn h-9"
            disabled={!connected || machineBusy}
            onClick={() => {
              startPinTest()
              openSettingsAt('board')
            }}
          >
            {t('ui.diag.pinOpen')}
          </button>
          {!connected ? (
            <span className="font-mono text-[11px] text-slate-500">{t('ui.diag.pinNeedsConn')}</span>
          ) : machineBusy ? (
            <span className="font-mono text-[11px] text-slate-500">{t('board.test.busy')}</span>
          ) : null}
        </div>
      </div>

      {/* ── problem report ────────────────────────────────────────────────── */}
      <div className="mt-2 flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="font-display text-xs font-bold uppercase tracking-wider text-brand">
          {t('ui.diag.reportTitle')}
        </h3>
        <p className="text-[11px] leading-snug text-slate-500">{t('ui.diag.reportDesc')}</p>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            {t('ui.diag.noteLabel')}
          </span>
          <textarea
            className="input min-h-[4.5rem] resize-y py-2 leading-snug"
            placeholder={t('ui.diag.notePlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="flex items-center gap-2">
          <button className="btn h-9 border-brand text-brand" onClick={build} disabled={busy}>
            {busy ? t('ui.diag.building') : t('ui.diag.build')}
          </button>
          {failed && <span className="font-mono text-[11px] text-danger">{t('ui.diag.failed')}</span>}
        </div>

        {report && (
          <div className="flex flex-col gap-2 rounded-lg border border-ok/40 bg-ok/5 p-3">
            <div className="text-[11px] text-slate-300">{t('ui.diag.done')}</div>
            <div className="select-text break-all font-mono text-[11px] text-ok">{report.path}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
              {t('ui.diag.contents')}
            </div>
            <ul className="flex flex-col gap-0.5">
              {report.entries.map((e) => (
                <li key={e.name} className="flex justify-between gap-3 font-mono text-[11px] text-slate-400">
                  <span className="truncate">{e.name}</span>
                  <span className="shrink-0 text-slate-600">{fmtSize(e.size)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] leading-snug text-slate-500">{t('ui.diag.privacy')}</p>
          </div>
        )}

        {/* The recovery opens itself when the board stops answering, which is how it is
            meant to be found. This is the way in when it does not: someone on the phone
            walking an operator through a board that is misbehaving differently, or a
            second attempt after the firmware panel finished its half. Kept here rather
            than given a category of its own — a permanent "Recovery" heading is clutter
            for everyone who will never need it, and no comfort to whoever does. */}
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-4">
          <button
            className="btn h-9 w-fit border-warn text-warn"
            onClick={() => useStore.getState().setRescueWizardOpen(true)}
          >
            {t('ui.sys.rescue')}
          </button>
          <span className="text-[10px] leading-snug text-slate-500">{t('ui.sys.rescueHint')}</span>
        </div>
      </div>
    </div>
  )
}
