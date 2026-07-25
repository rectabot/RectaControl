import { useT } from '../i18n'

/** RectaControl app version. Bump on release; later wire to electron-updater. */
const APP_VERSION = '0.1.0'

/** App version info. Updates are automatic: the updater checks in the background
 *  and an UpdateToast pops up when one is ready — no manual "check" button. */
export function AppUpdate(): JSX.Element {
  const t = useT()
  return (
    <div className="border-t border-border p-4">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">{t('ui.app.app')}</div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="font-mono text-sm text-slate-200">RectaControl</div>
          <div className="font-mono text-[11px] text-slate-500">{t('ui.app.version', { v: APP_VERSION })}</div>
        </div>
        <span className="rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 font-mono text-[10px] text-ok">
          {t('ui.app.latest')}
        </span>
      </div>
      <div className="mt-2 font-mono text-[10px] leading-relaxed text-slate-500">{t('ui.app.autoNote')}</div>
    </div>
  )
}
