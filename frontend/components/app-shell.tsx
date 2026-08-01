'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  LogOut,
  LogIn,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { API_BASE_URL } from '@/lib/config'
import { api } from '@/lib/api'
import { useAuth } from '@/components/auth-provider'
import { Spinner } from '@/components/ui/primitives'

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

function AccountBox() {
  const { user, isLoading, isAuthenticated, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <span className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
        <span className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return (
      <Link
        href="/login"
        className="flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <LogIn className="size-4" />
        Login
      </Link>
    )
  }

  return (
    <div ref={ref} className="relative">
      {menuOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <button
            onClick={async () => {
              setSigningOut(true)
              await logout()
              setSigningOut(false)
            }}
            disabled={signingOut}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            {signingOut ? (
              <Spinner className="size-4" />
            ) : (
              <LogOut className="size-4" />
            )}
            Logout
          </button>
        </div>
      )}
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl || '/placeholder.svg'}
            alt={user.name}
            referrerPolicy="no-referrer"
            className="size-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {user.name?.charAt(0)?.toUpperCase() || '?'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {user.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {user.email}
          </p>
        </div>
        <LogOut className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // The login page is a standalone auth screen — no dashboard chrome.
  if (pathname === '/login') {
    return <>{children}</>
  }

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
        <div className="space-y-3">
          <AccountBox />
          <HealthDot />
        </div>
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
            <div className="mt-4 space-y-3">
              <AccountBox />
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
