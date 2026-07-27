import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Last line of defence for the UI.
 *
 * A thrown error inside render unmounts the whole React tree, and what the
 * operator sees is a black window — at the exact moment they most need to read
 * the machine. That is unacceptable in a sender: the controller keeps streaming
 * from the main process, so the machine is still moving while the screen has gone
 * dark and silent.
 *
 * This boundary turns that into something usable: the error and where it came
 * from, in text that can be copied into a bug report, plus a reload that rebuilds
 * the window WITHOUT touching the machine (the connection and the running job live
 * in the main process, not here). It also states that plainly, because the first
 * question anyone has is "is my part ruined?".
 */
interface State {
  error: Error | null
  stack: string | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? null })
    // also into the terminal window's log, so it survives the reload
    console.error('[RectaControl] UI crashed:', error, info.componentStack)
  }

  private report(): string {
    const { error, stack } = this.state
    return `${error?.name}: ${error?.message}\n\n${error?.stack ?? ''}\n\nComponent stack:${stack ?? ''}`
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-screen flex-col gap-3 bg-base p-6 text-slate-200">
        <div>
          <h1 className="font-display text-xl font-bold text-danger">The interface stopped</h1>
          <p className="mt-1 text-sm text-slate-300">
            Something in the UI threw an error. <strong>The machine is not affected</strong> — the
            connection and any running job live outside this window. Reloading rebuilds the screen
            without stopping the job. If the machine needs to stop, use the physical E-stop.
          </p>
        </div>

        <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-warn">
          {this.report()}
        </pre>

        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border-2 border-ok px-4 py-2 text-sm font-semibold text-ok transition hover:bg-ok hover:text-[#020617]"
          >
            Reload interface
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(this.report())}
            className="rounded-lg border-2 border-border2 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-brand hover:text-brand"
          >
            Copy details
          </button>
        </div>
      </div>
    )
  }
}
