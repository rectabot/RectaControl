import { useStore } from '../store'
import { useT } from '../i18n'
import { isAutoZoom, setUiZoom, stepZoom } from '../zoom'

/** Theme picker (Settings → System → Theme). Cards for each theme; more can be
 *  added to THEMES later. Replaces the old TopBar toggle. */
const THEMES: {
  id: 'dark' | 'light' | 'softlight' | 'violet'
  label: string
  sample: { bg: string; panel: string; brand: string }
}[] = [
  { id: 'dark', label: 'ui.theme.dark', sample: { bg: '#0a1421', panel: '#111c2e', brand: '#22d3ee' } },
  { id: 'light', label: 'ui.theme.light', sample: { bg: '#e2e8f0', panel: '#f8fafc', brand: '#0891b2' } },
  { id: 'softlight', label: 'ui.theme.softlight', sample: { bg: '#e3e6ec', panel: '#eef1f6', brand: '#0891b2' } },
  { id: 'violet', label: 'ui.theme.violet', sample: { bg: '#100c1c', panel: '#1a1430', brand: '#22d3ee' } }
]

export function ThemeSettings(): JSX.Element {
  const t = useT()
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  // zoomFactor is echoed by main whenever the scale changes → the readout + Auto
  // highlight re-render live (including on Ctrl +/−/0 and monitor changes)
  const zoomFactor = useStore((s) => s.zoomFactor)
  const auto = isAutoZoom()

  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-brand">
        {t('ui.settings.cat.theme')}
      </h3>
      <p className="text-[11px] leading-snug text-slate-500">{t('ui.theme.desc')}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEMES.map((th) => {
          const active = theme === th.id
          return (
            <button
              key={th.id}
              onClick={() => setTheme(th.id)}
              className={`flex flex-col gap-2 rounded-lg border p-2 text-left transition ${
                active ? 'border-brand ring-1 ring-brand' : 'border-border hover:border-brand/50'
              }`}
            >
              {/* mini preview */}
              <div
                className="flex h-16 items-center gap-1 rounded-md p-2"
                style={{ background: th.sample.bg }}
              >
                <div className="h-full w-8 rounded" style={{ background: th.sample.panel }} />
                <div className="flex-1 space-y-1">
                  <div className="h-2 w-3/4 rounded" style={{ background: th.sample.brand }} />
                  <div className="h-1.5 w-1/2 rounded" style={{ background: th.sample.panel }} />
                </div>
              </div>
              <div className="flex items-center justify-between px-0.5">
                <span className="text-sm font-medium text-slate-200">{t(th.label)}</span>
                {active && <span className="font-mono text-[10px] text-brand">✓</span>}
              </div>
            </button>
          )
        })}
      </div>

      {/* UI scale — auto-fits to the monitor, with a manual override for taste */}
      <div className="mt-2 flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="font-display text-xs font-bold uppercase tracking-wider text-brand">
          {t('ui.zoom.title')}
        </h3>
        <p className="text-[11px] leading-snug text-slate-500">{t('ui.zoom.desc')}</p>
        <div className="flex items-center gap-2">
          <button
            className="btn h-9 w-10 !px-0 text-lg leading-none"
            onClick={() => stepZoom(-0.1)}
            title={t('ui.zoom.smaller')}
          >
            −
          </button>
          <span className="min-w-[5rem] text-center font-mono text-base text-slate-100">
            {Math.round(zoomFactor * 100)}%
          </span>
          <button
            className="btn h-9 w-10 !px-0 text-lg leading-none"
            onClick={() => stepZoom(0.1)}
            title={t('ui.zoom.larger')}
          >
            +
          </button>
          <button
            className={`btn h-9 ${auto ? 'border-brand text-brand' : ''}`}
            onClick={() => setUiZoom(null)}
          >
            {t('ui.zoom.auto')}
            {auto && <span className="ml-1.5 font-mono text-[10px]">✓</span>}
          </button>
        </div>
        <p className="text-[10px] text-slate-500">{t('ui.zoom.hint')}</p>
      </div>
    </div>
  )
}
