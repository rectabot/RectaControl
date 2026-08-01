import { useEffect, useRef, useState } from 'react'
import { useStore, parserSilentFor } from './store'
import { readOffsets, applyOffsetsRead } from './offsets'
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
  const connected = useStore((s) => s.connected)
  const info = useStore((s) => s.info)
  // an unresolved alarm/error, and its event counter. `seq` bumps only on a
  // genuinely new event, which is what the console auto-focus below keys on.
  const alertActive = useStore((s) => s.alert != null)
  const alertSeq = useStore((s) => s.alert?.seq ?? 0)
  // the live input test suspends hard limits, so the machine must not be jogged
  // while it runs — see the effect below
  const pinTest = useStore((s) => s.pinTest)
  const parkSynced = useRef(false)
  const pinTestWas = useRef(false)
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

  // An update is found and downloaded by the main process, which may well have
  // done it before this window subscribed (or before a reload) — so ask for one
  // already waiting as well as listening for the next.
  useEffect(() => {
    const off = window.recta.onUpdateReady((u) => useStore.getState().setUpdate(u))
    void window.recta.pendingUpdate().then((u) => {
      if (u) useStore.getState().setUpdate(u)
    })
    return off
  }, [])

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
      state !== 'Alarm' &&
      // an alarm can land a tick before the job/state updates catch up — without
      // this the preview would grab the tab back from the console for that tick
      !alertActive
    if (cutting) {
      setBottomTab('gcode')
      setTermExpanded(true)
    } else if (!pinTest) {
      // the input test owns the expansion while it runs (below) — collapsing here
      // on any state change would hand the Jog panel back mid-test
      setTermExpanded(false)
    }
  }, [state, jobRunning, sdRunning, parked, alertActive, pinTest, setBottomTab])

  // The input test runs with hard limits suspended, so jogging is the one thing
  // that must not happen: nothing would stop the head at the end of travel. Rather
  // than print a warning nobody reads, take the Jog panel away the same way a
  // running program does — the terminal expands over it. It is a cover, not a lock:
  // an operator who genuinely has to drive off a switch collapses the terminal and
  // the Jog panel is back. Fires only on the test's edges, so that choice sticks.
  useEffect(() => {
    if (pinTest && !pinTestWas.current) {
      setBottomTab('terminal')
      setTermExpanded(true)
    } else if (!pinTest && pinTestWas.current) {
      setTermExpanded(false)
    }
    pinTestWas.current = pinTest
  }, [pinTest, setBottomTab])

  // An alarm or a rejected line is the moment the console matters: the controller's
  // own message ([MSG:Emergency stop - clear, then reset to continue]) says what
  // happened, while the g-code preview it replaces describes a job that no longer
  // exists. Keyed on `seq`, so this fires once per event and never fights the
  // operator's own tab choice while the same alarm stays up.
  useEffect(() => {
    if (alertSeq > 0) setBottomTab('terminal')
  }, [alertSeq, setBottomTab])

  // one-time build marker in the terminal, so it's obvious at a glance whether
  // the running app is the freshly-built code (vs a stale `npm start` process)
  useEffect(() => {
    pushConsole('* RectaControl build 2026-07-30 · the app reconnects on its own after the board reboots; a factory dump can no longer overwrite the newest settings backup; and a board that greets you and then ignores every command now opens a guided recovery (Settings → Diagnostics has the way in when it does not open itself)')
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

  // Spot the failure that does not look like one: a board that answers `?` but not
  // commands. Status reports keep arriving because realtime bytes are handled in the
  // receive interrupt, while `$I` — sent on every connect — never comes back, because
  // the line parser is suspended. Nothing else in the app notices; the DRO simply
  // falls back to three axes and everything looks nearly right.
  //
  // `info.version` is the tell: it is set from $I and cleared on every connect. Ten
  // seconds is far longer than a healthy board needs, and the detector stays out of
  // the way while a program is streaming, where $I legitimately queues behind buffered
  // lines and a slow answer means nothing.
  //
  // …and out of the way of a machine that is SUSPENDED, which is the same silence for
  // an entirely ordinary reason. grblHAL parks its main loop in the suspend routine
  // for Hold, Door, Sleep, a homing cycle and a tool change: realtime bytes are still
  // served from the receive interrupt, so `?` answers, while every line waits. A
  // paused machine therefore looks exactly like a broken one from here.
  //
  // That matters because of what this offer leads to. On 1 Aug 2026 the app met a
  // board sitting in Door, decided it was broken, and offered the guided recovery —
  // whose first step erases the settings. Filip took it, on a machine whose only
  // fault was that it was paused. The backup put it back, but nothing about the
  // sequence should have started. And the parking pause makes Door an everyday
  // state now: pause a job, close the app, reopen it, and this is what you meet.
  // …and while the machine is EXECUTING, for the reason the comment above already
  // gives: `$I` queues behind buffered lines. `jobRunning`/`sdRunning` only know about
  // programs this app started, and a board can be running one it was handed earlier —
  // the leftover buffer of a stream that died with the app is enough, and a park
  // resumed after a restart runs exactly that.
  const SUSPENDED = ['Hold', 'Door', 'Sleep', 'Home', 'Tool', 'Run', 'Jog']
  const suspended = SUSPENDED.includes(state)
  useEffect(() => {
    if (!connected || jobRunning || sdRunning || suspended) return
    if (useStore.getState().info.version) {
      const s = useStore.getState()
      // The board has answered, so whatever we suspected is over. Take the offer back
      // DOWN as well — nothing used to, so a wizard the app had opened by itself sat
      // there afterwards with its destructive first step in front of an operator and
      // a healthy machine behind it. Only one this app raised: a wizard the operator
      // opened from Settings → Diagnostics is theirs to close.
      if (s.rescueSuggested) {
        s.setRescueSuggested(false)
        s.setRescueWizardOpen(false)
      }
      return
    }
    const timer = setTimeout(() => {
      const s = useStore.getState()
      if (!s.connected || s.info.version || s.job.running || s.sdRunning) return
      if (SUSPENDED.includes((s.status?.state ?? '').split(':')[0])) return
      if (!s.status) return // nothing is arriving at all — that is a plain disconnect
      // …and above all: has the parser answered ANYTHING? A missing `$I` is not the
      // question — the question is whether lines are being processed, and an `ok` or
      // an `error:` settles it. Without this the dialog appeared over a console still
      // printing replies, which is how a healthy machine gets its settings erased.
      if (parserSilentFor() < 10000) return
      s.setRescueSuggested(true)
      s.setRescueWizardOpen(true)
    }, 10000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, jobRunning, sdRunning, suspended, info.version])

  // Keep asking until the machine says who it is. `$I` used to go out on connect and
  // nowhere else, so connecting to a suspended board asked the one question that tells
  // the app how many axes the machine has at the only moment it cannot be answered —
  // and nothing ever asked again. The DRO then held its three-axis fallback for the
  // rest of the session, which is what Filip's screen showed on 1 Aug: a four-axis
  // machine drawn with three.
  //
  // That is worth more than a missing row. Beside an empty toolpath and a dialog
  // headed "recover the board", a machine that has lost an axis reads as a machine
  // that has been wiped — and an operator who believes that will act on it. So this
  // retries rather than trying once: a single lost reply must not be able to leave
  // the app lying about the machine for as long as it stays connected.
  useEffect(() => {
    if (!connected || suspended || info.version) return
    const ask = (): void => {
      const s = useStore.getState()
      if (!s.connected || s.info.version || s.job.running || s.sdRunning) return
      // Only when the parser is demonstrably alive. A board that is answering nothing
      // is not losing our question, it is queueing it — the one sent on connect is
      // already in that queue and will come back on its own. Asking again meanwhile
      // just stacks more: on 1 Aug five retries went out during a 20-second restore
      // and the board answered all six at once, six full $I dumps into the console.
      // The case this retry is actually for is the opposite one — a board replying to
      // everything except the `$I` we happened to send at a bad moment.
      if (parserSilentFor() > 3000) return
      window.recta.send('$I')
    }
    const first = setTimeout(ask, 400) // let the machine settle out of the suspend
    const timer = setInterval(ask, 3000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [connected, suspended, info.version])

  // Pick the link back up after the board goes away on its own.
  //
  // A controller reboot — $REBOOT, a watchdog reset, the rescue byte pairs — drops the
  // link in well under a second and the board is back a few seconds later. Until now the
  // app just sat there saying Offline, and the operator had to go and reconnect by hand
  // at the one moment they most want to see the machine answer. The flash flow already
  // did this; nothing else did.
  //
  // Ethernet alone for the first few tries, for the same reason as after a flash: the
  // W5500 takes longer to start listening than USB CDC does, and falling back the instant
  // TCP refuses would hand back a serial link to a machine that was on the network a
  // moment ago. `noReconnect` covers the two cases where the board is *meant* to be gone —
  // the operator disconnecting, and a flash in progress.
  const prevConnected = useRef(false)
  useEffect(() => {
    const wasConnected = prevConnected.current
    prevConnected.current = connected
    if (connected || !wasConnected) return
    if (useStore.getState().noReconnect) return

    let cancelled = false
    void (async () => {
      const lang = useStore.getState().lang
      const ethHost = localStorage.getItem('conn.ethHost') || '192.168.5.1'
      const ethPort = Number(localStorage.getItem('conn.ethPort')) || 23
      const baud = Number(localStorage.getItem('conn.baud')) || 115200
      pushConsole(`* ${translate('ui.app.reconnecting', lang)}`)
      for (let i = 0; i < 14; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        // bail out if the operator reconnected by hand, unplugged on purpose, or
        // started a flash while we were waiting
        if (cancelled) return
        const s = useStore.getState()
        if (s.connected || s.noReconnect) return
        try {
          if (i < 5) {
            await window.recta.connect({ kind: 'ethernet', host: ethHost, port: ethPort })
            return
          }
          if (await window.recta.autoConnect({ ethHost, ethPort, baud })) return
        } catch {
          /* not up yet — still booting, or this is not the cable it came back on */
        }
      }
      if (!cancelled && !useStore.getState().connected)
        pushConsole(`! ${translate('ui.app.reconnectGaveUp', lang)}`)
    })()

    return () => {
      cancelled = true
    }
  }, [connected])

  // Adopt the board's park spot (G30) the first time the machine reaches Idle on a
  // connection. G30 is non-volatile (verified on hardware), so the board is the durable
  // truth: this keeps a spot cached from an earlier session — or from another machine —
  // from steering the head somewhere the offsets table does not show. A board with
  // nothing stored leaves the app's saved spot untouched. `$#` is Idle-only (error:8).
  useEffect(() => {
    if (!connected) {
      parkSynced.current = false
      return
    }
    if (parkSynced.current || state !== 'Idle' || jobRunning || sdRunning) return
    parkSynced.current = true
    void readOffsets().then(applyOffsetsRead)
  }, [connected, state, jobRunning, sdRunning])

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
