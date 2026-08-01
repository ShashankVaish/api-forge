'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Flame, ShieldCheck, X } from 'lucide-react'
import { oauthStartUrl } from '@/lib/api'
import { useAuth } from '@/components/auth-provider'
import { Card, Spinner } from '@/components/ui/primitives'

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  )
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  )
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading } = useAuth()

  const errorProvider = searchParams.get('error')
  const [showError, setShowError] = useState(false)

  useEffect(() => {
    if (errorProvider) setShowError(true)
  }, [errorProvider])

  // Already signed in — send them into the app.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/keys')
    }
  }, [isLoading, isAuthenticated, router])

  if (isLoading || isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="size-6" />
        <p className="text-sm">Checking your session…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/25">
            <Flame className="size-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Sign in to API Forge
          </h1>
          <p className="mt-2 text-sm text-muted-foreground text-pretty">
            One key, every model. Continue with your account to manage keys and
            usage.
          </p>
        </div>

        {showError && (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <span className="leading-relaxed">
              Login failed
              {errorProvider === 'google' || errorProvider === 'github'
                ? ` with ${errorProvider === 'google' ? 'Google' : 'GitHub'}`
                : ''}
              , please try again.
            </span>
            <button
              onClick={() => setShowError(false)}
              aria-label="Dismiss error"
              className="shrink-0 rounded p-0.5 hover:bg-destructive/15"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <Card className="p-6">
          <div className="flex flex-col gap-3">
            <a
              href={oauthStartUrl('google')}
              className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-input bg-background/50 px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <GoogleIcon className="size-5" />
              Continue with Google
            </a>
            <a
              href={oauthStartUrl('github')}
              className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <GithubIcon className="size-5" />
              Continue with GitHub
            </a>
          </div>

          <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Secure OAuth sign-in — we never see your password.
          </div>
        </Card>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}
