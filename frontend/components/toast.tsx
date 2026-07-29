'use client'

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastVariant = 'success' | 'error' | 'info'

interface Toast {
  id: number
  title: string
  description?: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
}

const accents: Record<ToastVariant, string> = {
  success: 'text-chart-1',
  error: 'text-destructive',
  info: 'text-primary',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random()
      setToasts((prev) => [...prev, { ...t, id }])
      setTimeout(() => remove(id), 5000)
    },
    [remove],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end">
        {toasts.map((t) => {
          const Icon = icons[t.variant]
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur animate-in slide-in-from-bottom-2 fade-in"
            >
              <Icon
                className={cn('mt-0.5 size-5 shrink-0', accents[t.variant])}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-card-foreground">
                  {t.title}
                </p>
                {t.description && (
                  <p className="mt-1 text-sm text-muted-foreground break-words">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => remove(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
