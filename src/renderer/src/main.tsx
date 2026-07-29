import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
