import { API_BASE_URL } from './config'

// ---- Types matching the backend exactly ----

export interface KeyUsage {
  requests: number
  inputTokens: number
  outputTokens: number
}

export interface GeneratedKey {
  message: string
  id: string
  name: string | null
  key: string
  createdAt: string
}

export interface MaskedKey {
  id: string
  name: string | null
  maskedKey: string
  createdAt: string
  revoked: boolean
  usage: KeyUsage
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface RoutingInfo {
  routedBy: string
  tier: 'simple' | 'moderate' | 'complex'
  complexityScore: number
  reasons: string[]
  provider: string
  model: string
  modelLabel: string
  estimatedCostPer1kTokens: number
  latencyMs: number
  usedFallback: boolean
  fallbackReason: string | null
}

export interface ChatCompletion {
  id: string
  model: string
  routing: RoutingInfo
  choices: { message: ChatMessage }[]
  usage: { input_tokens: number; output_tokens: number }
}

export interface Stats {
  totalRequests: number
  byTier: { simple: number; moderate: number; complex: number }
  totalInputTokens: number
  totalOutputTokens: number
  estimatedActualCostUSD: number
  estimatedBaselineCostUSD_ifAlwaysTopTier: number
  estimatedSavingsUSD: number
  estimatedSavingsPercent: number
}

export interface AuthUser {
  id: string
  provider: string
  providerId: string
  email: string
  name: string
  avatarUrl: string
  createdAt: string
}

// ---- Error handling ----

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      // Session-cookie auth: send cookies with every request by default.
      // The chat endpoint opts out with `credentials: 'omit'` since it
      // authenticates via the Authorization: Bearer <forge_key> header only.
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
  } catch {
    throw new ApiError(
      `Could not reach the API Forge backend at ${API_BASE_URL}. Is it running?`,
      0,
    )
  }

  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : null) || `Request failed with status ${res.status}`
    throw new ApiError(message, res.status)
  }

  return data as T
}

// ---- Endpoints ----

export const api = {
  health: () => request<{ status: string; service: string }>('/health'),

  createKey: (name?: string) =>
    request<GeneratedKey>('/v1/keys', {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    }),

  listKeys: () => request<{ keys: MaskedKey[] }>('/v1/keys'),

  revokeKey: (id: string) =>
    request<{ revoked: boolean }>(`/v1/keys/${id}`, { method: 'DELETE' }),

  chat: (forgeKey: string, model: string, messages: ChatMessage[]) =>
    request<ChatCompletion>('/v1/chat/completions', {
      method: 'POST',
      // Bearer-only: do NOT send session cookies for this endpoint.
      credentials: 'omit',
      headers: { Authorization: `Bearer ${forgeKey}` },
      body: JSON.stringify({ model, messages }),
    }),

  stats: () => request<Stats>('/v1/stats'),

  // ---- Session auth (Passport.js, cookie-based) ----
  me: () => request<{ user: AuthUser }>('/auth/me'),

  logout: () => request<{ loggedOut: boolean }>('/auth/logout', {
    method: 'POST',
  }),
}

// OAuth login is a real browser redirect, not a fetch call.
export function oauthStartUrl(provider: 'google' | 'github') {
  return `${API_BASE_URL}/auth/${provider}`
}
