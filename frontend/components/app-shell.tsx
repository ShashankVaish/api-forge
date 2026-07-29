'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Flame,
  LayoutDashboard,
  KeyRound,
  TerminalSquare,
  BarChart3,
  Menu,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { API_BASE_URL } from '@/lib/config'
import { api } from '@/lib/api'

const nav = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/keys', label: 'API Keys', icon: KeyRound },
  { href: '/playground', label: 'Playground', icon: TerminalSquare },
  { href: '/stats', label: 'Analytics', icon: BarChart3 },
]

function HealthDot() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'down'>('checking')

  useEffect(() => {
    let active = true
    const check = () =>
      api
        .health()
        .then(() => active && setStatus('ok'))
        .catch(() => active && setStatus('down'))
    check()
    const interval = setInterval(check, 30000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  const map = {
    checking: { color: 'bg-muted-foreground', label: 'Checking backend…' },
    ok: { color: 'bg-chart-1', label: 'Backend online' },
    down: { color: 'bg-destructive', label: 'Backend offline' },
  }
  const s = map[status]

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <span className="relative flex size-2">
        {status === 'ok' && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-1 opacity-60" />
        )}
        <span className={cn('relative inline-flex size-2 rounded-full', s.color)} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{s.label}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {API_BASE_URL}
        </p>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const navList = (
    <nav className="flex flex-col gap-1">
      {nav.map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )

  const brand = (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25">
        <Flame className="size-5" />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">API Forge</p>
        <p className="text-[11px] text-muted-foreground">AI Gateway</p>
      </div>
    </Link>
  )

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar p-4 lg:flex">
        <div className="px-2 py-2">{brand}</div>
        <div className="mt-6 flex-1">{navList}</div>
        <HealthDot />
      </aside>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-sidebar-border bg-sidebar/95 px-4 backdrop-blur lg:hidden">
        {brand}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-20 lg:hidden">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 top-14 border-b border-sidebar-border bg-sidebar p-4">
            {navList}
            <div className="mt-4">
              <HealthDot />
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 pt-14 lg:pt-0 lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  )
}
