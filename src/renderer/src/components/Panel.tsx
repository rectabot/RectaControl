import type { ReactNode } from 'react'

export function Panel({
  title,
  children,
  className = '',
  actions
}: {
  title?: string
  children: ReactNode
  className?: string
  actions?: ReactNode
}): JSX.Element {
  return (
    <div className={`rounded-lg border border-border bg-panel ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="font-mono text-xs uppercase tracking-wider text-slate-500">
            {title ?? ''}
          </span>
          {actions}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  )
}
