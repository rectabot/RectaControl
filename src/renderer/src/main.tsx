import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// Errors thrown outside React's render path (event handlers, IPC callbacks, async
// work) never reach the boundary below, so surface them too rather than letting
// them vanish into a DevTools window nobody has open.
window.addEventListener('error', (e) =>
  console.error('[RectaControl] uncaught:', e.error ?? e.message)
)
window.addEventListener('unhandledrejection', (e) =>
  console.error('[RectaControl] unhandled rejection:', e.reason)
)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
