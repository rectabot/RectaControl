import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'

/** App version + update state. The version comes from the running app itself
 *  (package.json / the installer), not a constant someone has to remember to
 *  bump. Updates are automatic: main checks in the background and the UpdateToast
 *  appears when one is ready — so there is no manual "check" button here, only
 *  what the app currently knows. */
export function AppUpdate(): JSX.Element {
  const t = useT()
  const update = useStore((s) => s.update)
  const [version, setVersion] = useState('…')

  useEffect(() => {
    void window.recta.appVersion().then(setVersion)
  }, [])

  return (
    <div className="border-t border-border p-4">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">{t('ui.app.app')}</div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="font-mono text-sm text-slate-200">RectaControl</div>
          <div className="font-mono text-[11px] text-slate-500">{t('ui.app.version', { v: version })}</div>
        </div>
        {update ? (
          <span className="rounded-full border border-[#3390EC]/40 bg-[#3390EC]/10 px-2.5 py-1 font-mono text-[10px] text-[#3390EC]">
            {t('ui.app.updateReady', { v: update.version })}
          </span>
        ) : (
          <span className="rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 font-mono text-[10px] text-ok">
            {t('ui.app.latest')}
          </span>
        )}
      </div>
      <div className="mt-2 font-mono text-[10px] leading-relaxed text-slate-500">{t('ui.app.autoNote')}</div>
    </div>
  )
}
