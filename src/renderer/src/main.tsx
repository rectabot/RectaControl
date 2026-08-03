import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// The theme, before React draws anything. App keeps this in step afterwards, but its
// effect runs after the first frame — so a light-theme machine drew one dark frame on
// every reload, because dark is what index.css is without a class on <html>. Reading
// localStorage is synchronous, so there is no reason for that frame to be wrong.
{
  const theme = localStorage.getItem('theme')
  if (theme === 'light' || theme === 'softlight' || theme === 'violet')
    document.documentElement.classList.add(theme)
}

// Errors thrown outside React's render path (event handlers, IPC callbacks, async
// work) never reach the boundary below, so surface them too rather than letting
// them vanish into a DevTools window nobody has open. Both also go to the on-disk
// log, because the operator who hits this is not the person who will read it.
window.addEventListener('error', (e) => {
  const err = e.error as Error | undefined
  console.error('[RectaControl] uncaught:', e.error ?? e.message)
  window.recta.logWrite('err', `renderer uncaught: ${err?.stack ?? e.message} (${e.filename}:${e.lineno})`)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[RectaControl] unhandled rejection:', e.reason)
  const r = e.reason
  window.recta.logWrite('err', `renderer unhandled rejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`)
})

const container = document.getElementById('root')!
const tree = (
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

let root = createRoot(container)
root.render(tree)

// Ctrl+R / F5 rebuild the interface here rather than reloading the document.
//
// A document reload flashes white — Chromium composites between two documents against a
// base colour below the page, which Electron 32 gives no way to set — and it throws away
// a window that had nothing wrong with its document. Everything a refresh is actually
// for is in this tree: component state, effects, a view stuck in some arrangement it
// cannot leave. Unmounting and building it again costs no navigation and no white frame,
// and the connection is untouched throughout, because it was never in here.
//
// Main is told when this is done; if it is not told, it reloads the document after all,
// on the reasoning that a window too stuck to answer is too stuck for a rebuild to help.
window.recta.onRebuild(() => {
  root.unmount()
  root = createRoot(container)
  root.render(tree)
  void window.recta.rebuilt()
})
