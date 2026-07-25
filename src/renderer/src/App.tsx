import { useEffect, useState } from 'react'
import { useStore } from './store'
import { t as translate } from '@shared/i18n'
import { TopBar } from './components/TopBar'
import { DRO } from './components/DRO'
import { JogPanel } from './components/JogPanel'
import { Visualizer } from './components/Visualizer'
import { RightTabs } from './components/RightTabs'
import { StatusBar } from './components/StatusBar'
import { SettingsBrowser } from './components/SettingsBrowser'
import { OffsetsTable } from './components/OffsetsTable'
import { ProbePanel } from './components/ProbePanel'
import { FromLineDialog } from './components/FromLineDialog'
import { FileManager } from './components/FileManager'
import { Tracker } from './components/Tracker'
import { UpdateToast } from './components/UpdateToast'
import { ConfirmDialog } from './components/ConfirmDialog'
import { RotaryLoadPrompt } from './components/RotaryLoadPrompt'
import { useKeyboardControls } from './useKeyboardControls'
import { useGamepadControls } from './useGamepadControls'
import { useCloseGuard } from './useCloseGuard'
import { useZoom } from './zoom'

export default function App(): JSX.Element {
  const apply = useStore((s) => s.apply)
  const theme = useStore((s) => s.theme)
  const pushConsole = useStore((s) => s.pushConsole)
  const setBottomTab = useStore((s) => s.setBottomTab)
  // machine run-state (base, before the ':') + whether a real PROGRAM is running
  // drive the auto-expand. Keying on a real job (not merely the 'Run' machine state)
  // matters: Park moves the head with G53/G30 which briefly shows 'Run', and that
  // must NOT re-expand the terminal over the Jog panel mid-park.
  const state = useStore((s) => (s.status?.state ?? '').split(':')[0])
  const jobRunning = useStore((s) => s.job.running)
  const sdRunning = useStore((s) => s.sdRunning)
  const parked = useStore((s) => s.parked)
  // global keyboard + gamepad jog / shortcuts (Settings → Controls)
  useKeyboardControls()
  useGamepadControls()
  // intercept the window-close (X) when a job is streaming → ask before quitting
  useCloseGuard()
  // auto-fit the UI scale to the monitor (+ manual override, Ctrl +/−/0)
  useZoom()
  // when the terminal/g-code panel is expanded it grows in height by taking over
  // the Jog panel's space (Jog is hidden while expanded)
  const [termExpanded, setTermExpanded] = useState(false)

  useEffect(() => {
    const off = window.recta.onEvent((e) => apply(e))
    return off
  }, [apply])

  // Take over the Jog panel's space with the g-code preview ONLY while a real program
  // is actively cutting. Collapsed for everything else — idle, pause/Hold/Door, Alarm,
  // and the whole Park→jog→Resume flow (parked, or the head moving to G30) — so the
  // Jog panel stays available until the program actually runs again.
  useEffect(() => {
    const cutting =
      (jobRunning || sdRunning) &&
      !parked &&
      state !== 'Hold' &&
      state !== 'Door' &&
      state !== 'Alarm'
    if (cutting) {
      setBottomTab('gcode')
      setTermExpanded(true)
    } else {
      setTermExpanded(false)
    }
  }, [state, jobRunning, sdRunning, parked, setBottomTab])

  // one-time build marker in the terminal, so it's obvious at a glance whether
  // the running app is the freshly-built code (vs a stale `npm start` process)
  useEffect(() => {
    pushConsole('* RectaControl build 2026-07-20o · Home button turns green when the machine is homed; Park (go-to-park from Idle) now needs a press-and-hold to fire, guarding a stray tap')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On launch: auto-connect, preferring Ethernet and falling back to USB.
  // Runs ONCE on mount — do not depend on `t` (its identity changes every render,
  // which would re-fire auto-connect and drop a live connection on language change).
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const lang = useStore.getState().lang
      const ethHost = localStorage.getItem('conn.ethHost') || '192.168.5.1'
      const ethPort = Number(localStorage.getItem('conn.ethPort')) || 23
      const baud = Number(localStorage.getItem('conn.baud')) || 115200
      pushConsole(`* ${translate('ui.top.autoTry', lang)}`)
      try {
        const kind = await window.recta.autoConnect({ ethHost, ethPort, baud })
        if (cancelled) return
        if (!kind) pushConsole(`! ${translate('ui.app.autoFailManual', lang)}`)
      } catch (e) {
        if (!cancelled) pushConsole(`! ${translate('ui.top.autoErr', lang, { msg: (e as Error).message })}`)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // 'dark' is the base (no class); other themes add their class to <html>
    const el = document.documentElement
    el.classList.remove('light', 'softlight', 'violet')
    if (theme !== 'dark') el.classList.add(theme)
  }, [theme])

  return (
    <div className="flex h-full flex-col gap-2 bg-base p-2 text-slate-100">
      <TopBar />

      <div className="grid min-h-0 flex-1 grid-cols-[450px_1fr] gap-2 overflow-hidden">
        {/* left: controls + tabbed terminal/g-code */}
        <div className="flex min-h-0 flex-col gap-2">
          <DRO />
          {!termExpanded && <JogPanel />}
          <RightTabs expanded={termExpanded} onToggleExpand={() => setTermExpanded((v) => !v)} />
        </div>

        {/* right: visualizer with all job/probe controls inside it — Settings
            swaps in over just this pane, so the TopBar, left column and footer
            stay put and nothing resizes when switching screens */}
        <div className="relative min-h-0 min-w-0">
          <Visualizer />
          <SettingsBrowser />
          <ProbePanel />
        </div>
      </div>

      <StatusBar />
      <OffsetsTable />
      <FromLineDialog />
      <FileManager />
      <Tracker />
      <UpdateToast />
      <ConfirmDialog />
      <RotaryLoadPrompt />
    </div>
  )
}
