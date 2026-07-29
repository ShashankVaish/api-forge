'use client'

// Persists FULL forge keys locally so the Playground can reuse them as bearer
// tokens. The backend only ever returns the full key once (on creation), so we
// stash it in localStorage on this device. These are the developer's own keys.

const STORAGE_KEY = 'api-forge:saved-keys'

export interface SavedKey {
  id: string
  name: string | null
  key: string
  createdAt: string
}

function read(): SavedKey[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedKey[]) : []
  } catch {
    return []
  }
}

function write(keys: SavedKey[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  window.dispatchEvent(new Event('api-forge:keys-changed'))
}

export const keyStore = {
  getAll: read,
  add(key: SavedKey) {
    const keys = read().filter((k) => k.id !== key.id)
    write([key, ...keys])
  },
  remove(id: string) {
    write(read().filter((k) => k.id !== id))
  },
}

export function maskKey(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}
