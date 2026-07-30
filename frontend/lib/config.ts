// Base URL for the API Forge backend. Override via NEXT_PUBLIC_API_FORGE_BASE_URL.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_FORGE_BASE_URL?.replace(/\/$/, '') ||
  'http://localhost:3001'

// The full list of models accepted by POST /v1/chat/completions.
export const MODELS = [
  { value: 'auto', label: 'Auto (smart routing)', group: 'Routing' },
  { value: 'haiku', label: 'Claude Haiku', group: 'Anthropic' },
  { value: 'sonnet', label: 'Claude Sonnet', group: 'Anthropic' },
  { value: 'opus', label: 'Claude Opus', group: 'Anthropic' },
  { value: 'groq-fast', label: 'Groq Fast', group: 'Groq' },
  { value: 'groq-strong', label: 'Groq Strong', group: 'Groq' },
  { value: 'gemini-flash', label: 'Gemini Flash', group: 'Gemini' },
  { value: 'gemini-pro', label: 'Gemini Pro', group: 'Gemini' },
  { value: 'mistral-small', label: 'Mistral Small', group: 'Mistral' },
  { value: 'mistral-large', label: 'Mistral Large', group: 'Mistral' },
] as const

export type ModelValue = (typeof MODELS)[number]['value']
