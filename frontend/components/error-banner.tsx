'use client'

import { AlertTriangle, X } from 'lucide-react'

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss?: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1 leading-relaxed break-words">{message}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="shrink-0 rounded-md p-1 transition-colors hover:bg-destructive/15"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
