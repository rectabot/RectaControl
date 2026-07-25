import { useStore } from '../store'
import { useT, useLabel } from '../i18n'
import { Console } from './Console'
import { GcodePreview } from './GcodePreview'
import { Macros } from './Macros'

export function RightTabs({
  expanded,
  onToggleExpand
}: {
  expanded: boolean
  onToggleExpand: () => void
}): JSX.Element {
  const t = useT()
  const L = useLabel()
  // tab lives in the store so loading a file / starting a job can focus the preview
  const tab = useStore((s) => s.bottomTab)
  const setTab = useStore((s) => s.setBottomTab)
  const clearConsole = useStore((s) => s.clearConsole)

  const body = tab === 'terminal' ? <Console /> : tab === 'gcode' ? <GcodePreview /> : <Macros />

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-panel">
      <div className="flex items-center border-b border-border px-2">
        <TabBtn active={tab === 'terminal'} onClick={() => setTab('terminal')}>
          {L('ui.tabs.terminal')}
        </TabBtn>
        <TabBtn active={tab === 'gcode'} onClick={() => setTab('gcode')}>
          {L('ui.tabs.gcode')}
        </TabBtn>
        <TabBtn active={tab === 'macros'} onClick={() => setTab('macros')}>
          {L('ui.tabs.macros')}
        </TabBtn>
        <div className="ml-auto flex items-center gap-1">
          {tab === 'terminal' && (
            <button className="px-2 py-1 text-xs text-slate-500 hover:text-slate-300" onClick={clearConsole}>
              {L('ui.tabs.clear')}
            </button>
          )}
          {/* grow the panel by taking over the Jog panel's height (App hides Jog) */}
          <button
            className="px-2 py-1 text-slate-500 transition hover:text-brand"
            onClick={onToggleExpand}
            title={t(expanded ? 'ui.tabs.collapse' : 'ui.tabs.expand')}
          >
            {expanded ? '⤡' : '⤢'}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 font-mono text-xs transition ${
        active ? 'border-b-2 border-brand text-brand' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}
