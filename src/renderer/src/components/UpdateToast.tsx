import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'

/** Auto-popup update notification: the main process finds and downloads the
 *  update on its own, and when one is ready a toast appears bottom-right.
 *  Click it → details modal (what's fixed) → "Update now" installs and restarts.
 *
 *  Two answers other than "installing" are possible, and both are shown in place
 *  rather than silently doing nothing: the app refuses to restart while a program
 *  is streaming (that would cut the job in half), and a portable build cannot
 *  replace itself, so it opens the download page instead. */
export function UpdateToast(): JSX.Element | null {
  const t = useT()
  const update = useStore((s) => s.update)
  const setUpdate = useStore((s) => s.setUpdate)
  const pushConsole = useStore((s) => s.pushConsole)
  const [open, setOpen] = useState(false)
  const [refused, setRefused] = useState<'busy' | 'manual' | 'none' | null>(null)

  if (!update) return null

  const start = async (): Promise<void> => {
    setRefused(null)
    const res = await window.recta.installUpdate()
    if (res.ok) {
      // the app is about to quit and relaunch into the new version
      pushConsole(t('ui.upd.started', { version: update.version }))
      setOpen(false)
      setUpdate(null)
      return
    }
    setRefused(res.reason)
    if (res.reason === 'manual') {
      // the download page is already open in the browser — the toast has done its job
      pushConsole(t('ui.upd.manualConsole', { version: update.version }))
      setOpen(false)
      setUpdate(null)
    }
  }

  return (
    <>
      {/* toast */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[55] flex items-center gap-3 rounded-lg border border-[#3390EC]/50 bg-panel px-4 py-3 text-left shadow-glow transition hover:border-[#3390EC]"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3390EC] text-[#020617]">⬆</span>
        <span>
          <span className="block text-sm font-semibold text-slate-100">{t('ui.upd.available')}</span>
          <span className="block font-mono text-[11px] text-[#3390EC]">RectaControl v{update.version}</span>
        </span>
      </button>

      {/* details modal */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex w-full max-w-md flex-col rounded-lg border border-border bg-panel shadow-glow"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="font-display text-sm font-bold tracking-wider text-[#3390EC]">
                ⬆ {t('ui.upd.title', { version: update.version })}
              </span>
              <button className="btn ml-auto text-xs" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-4">
              <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">{t('ui.upd.whatsNew')}</div>
              <ul className="flex flex-col gap-1.5">
                {update.notes.map((n, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-200">
                    <span className="text-[#3390EC]">•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-2 border-t border-border px-4 py-3">
              {refused === 'busy' && (
                <span className="flex-1 text-[11px] leading-snug text-warn">{t('ui.upd.busy')}</span>
              )}
              {refused === 'none' && (
                <span className="flex-1 text-[11px] leading-snug text-warn">{t('ui.upd.gone')}</span>
              )}
              <button
                className="ml-auto rounded-md border border-border2 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-400"
                onClick={() => setOpen(false)}
              >
                {t('ui.upd.later')}
              </button>
              <button
                className="rounded-md bg-[#3390EC] px-4 py-2 text-sm font-semibold text-[#020617] transition hover:opacity-90"
                onClick={start}
              >
                {update.manual ? t('ui.upd.download') : t('ui.upd.now')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
