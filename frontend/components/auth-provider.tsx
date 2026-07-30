'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { SWRConfig } from 'swr'
import { api, ApiError, type AuthUser } from '@/lib/api'

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await api.me()
      setUser(res.user)
    } catch {
      setUser(null)
    }
  }, [])

  // Initial session check on app load. We keep isLoading true until this
  // resolves so the UI never flashes a logged-out state prematurely.
  useEffect(() => {
    let active = true
    api
      .me()
      .then((res) => active && setUser(res.user))
      .catch(() => active && setUser(null))
      .finally(() => active && setIsLoading(false))
    return () => {
      active = false
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // Even if the request fails, clear local state so the user is signed out.
    }
    setUser(null)
    router.push('/login')
  }, [router])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        logout,
        refresh,
      }}
    >
      <SWRConfig
        value={{
          // If any data fetch hits a 401, the session expired — clear auth
          // state and send the user to the login page instead of showing a
          // generic error.
          onError: (err) => {
            if (err instanceof ApiError && err.status === 401) {
              setUser(null)
              router.push('/login')
            }
          },
        }}
      >
        {children}
      </SWRConfig>
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
