'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth-provider'
import { Spinner } from '@/components/ui/primitives'

// The backend redirects here after a successful OAuth login. We re-check the
// freshly created session, then forward the user into the Keys dashboard.
export default function DashboardPage() {
  const router = useRouter()
  const { refresh } = useAuth()

  useEffect(() => {
    let active = true
    refresh().finally(() => {
      if (active) router.replace('/keys')
    })
    return () => {
      active = false
    }
  }, [refresh, router])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner className="size-6" />
      <p className="text-sm">Signing you in…</p>
    </div>
  )
}
