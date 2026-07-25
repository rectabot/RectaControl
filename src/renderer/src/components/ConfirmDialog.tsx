import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useT } from '../i18n'

/** The one shared confirmation modal, driven by store `confirm` / `askConfirm`.
 *  Mounted once (App). Every guarded action (disconnect / quit / flash mid-job …)
 *  calls `askConfirm(...)` and awaits the user's choice — no per-call-site modal. */
export function ConfirmDialog(): JSX.Element | null {
  const t = useT()
  const confirm = useStore((s) => s.confirm)
  const resolve = useStore((s) => s.resolveConfirm)
  if (!confirm) return null

  const tone = confirm.tone ?? 'danger'
  const border = tone === 'warn' ? 'border-warn/50' : 'border-danger/50'
  const heading = tone === 'warn' ? 'text-warn' : 'text-danger'
  const confirmBtn =
    tone === 'warn'
      ? 'bg-warn text-[#020617] hover:opacity-90'
      : 'bg-danger text-white hover:opacity-90'

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={() => resolve(false)}
    >
      <div
        className={`w-full max-w-md rounded-lg border ${border} bg-panel shadow-glow`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center gap-2 border-b border-border px-5 py-3 font-display text-sm font-bold tracking-wider ${heading}`}
        >
          ⚠ {confirm.title}
        </div>
        <div className="px-5 py-4 text-[13px] leading-relaxed text-slate-300">{confirm.body}</div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            className="rounded-md border border-border2 px-4 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-border"
            onClick={() => resolve(false)}
          >
            {confirm.cancelLabel ?? t('ui.confirm.cancel')}
          </button>
          <button
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${confirmBtn}`}
            onClick={() => resolve(true)}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
