'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Send,
  Bot,
  User,
  Trash2,
  TerminalSquare,
  KeyRound,
} from 'lucide-react'
import {
  api,
  ApiError,
  type ChatMessage,
  type RoutingInfo,
} from '@/lib/api'
import { MODELS } from '@/lib/config'
import { keyStore, maskKey, type SavedKey } from '@/lib/key-store'
import { useToast } from '@/components/toast'
import { PageHeader } from '@/components/page-header'
import { RoutingCard } from '@/components/routing-card'
import { ErrorBanner } from '@/components/error-banner'
import { Button } from '@/components/ui/button'
import {
  Card,
  Input,
  Label,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

interface ThreadMessage extends ChatMessage {
  routing?: RoutingInfo
  usage?: { input_tokens: number; output_tokens: number }
}

const MANUAL = '__manual__'

function useSavedKeys() {
  const [keys, setKeys] = useState<SavedKey[]>([])
  useEffect(() => {
    const sync = () => setKeys(keyStore.getAll())
    sync()
    window.addEventListener('api-forge:keys-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('api-forge:keys-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return keys
}

export default function PlaygroundPage() {
  const { toast } = useToast()
  const savedKeys = useSavedKeys()

  const [selectedKeyId, setSelectedKeyId] = useState<string>('')
  const [manualKey, setManualKey] = useState('')
  const [model, setModel] = useState('auto')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const threadRef = useRef<HTMLDivElement>(null)

  // Default the key selector to the first saved key.
  useEffect(() => {
    if (!selectedKeyId && savedKeys.length > 0) {
      setSelectedKeyId(savedKeys[0].id)
    }
  }, [savedKeys, selectedKeyId])

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, sending])

  const usingManual = selectedKeyId === MANUAL || savedKeys.length === 0
  const activeKey = usingManual
    ? manualKey.trim()
    : savedKeys.find((k) => k.id === selectedKeyId)?.key ?? ''

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    if (!activeKey) {
      setError('Select a saved key or paste a Forge key to use as the bearer token.')
      return
    }
    setError(null)

    const userMsg: ThreadMessage = { role: 'user', content: text }
    const history: ChatMessage[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: text },
    ]
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setSending(true)

    try {
      const res = await api.chat(activeKey, model, history)
      const choice = res.choices?.[0]?.message
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: choice?.content ?? '(empty response)',
          routing: res.routing,
          usage: res.usage,
        },
      ])
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Request failed unexpectedly.'
      setError(message)
      toast({ variant: 'error', title: 'Request failed', description: message })
      // roll back the optimistic user message so history stays consistent
      setMessages((prev) => prev.slice(0, -1))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Playground"
        description="Send prompts through the gateway and watch how each one gets routed. Conversation history is kept for the whole thread."
      />

      {/* Controls */}
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="key-select">Forge key</Label>
          <Select
            id="key-select"
            className="mt-2"
            value={usingManual ? MANUAL : selectedKeyId}
            onChange={(e) => setSelectedKeyId(e.target.value)}
          >
            {savedKeys.map((k) => (
              <option key={k.id} value={k.id}>
                {(k.name || 'Untitled') + ' — ' + maskKey(k.key)}
              </option>
            ))}
            <option value={MANUAL}>Paste a key manually…</option>
          </Select>
          {usingManual && (
            <Input
              className="mt-2 font-mono text-xs"
              placeholder="forge_..."
              value={manualKey}
              onChange={(e) => setManualKey(e.target.value)}
              type="password"
              autoComplete="off"
            />
          )}
          {savedKeys.length === 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="size-3" />
              No saved keys on this device — paste one, or generate one on the
              Keys page.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="model-select">Model</Label>
          <Select
            id="model-select"
            className="mt-2"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {/* Thread */}
      <Card className="flex h-[32rem] flex-col p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-muted-foreground">
            Conversation
          </span>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMessages([])
                setError(null)
              }}
            >
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          )}
        </div>

        <div ref={threadRef} className="flex-1 space-y-5 overflow-y-auto p-4">
          {messages.length === 0 && !sending && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <TerminalSquare className="size-6" />
              </span>
              <p className="font-medium">Start a conversation</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Try a simple greeting to see it routed to a cheap model, then a
                complex reasoning task to watch it escalate.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-3',
                m.role === 'user' ? 'flex-row-reverse' : 'flex-row',
              )}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg',
                  m.role === 'user'
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {m.role === 'user' ? (
                  <User className="size-4" />
                ) : (
                  <Bot className="size-4" />
                )}
              </span>
              <div
                className={cn(
                  'min-w-0 max-w-[85%] space-y-3',
                  m.role === 'user' && 'items-end',
                )}
              >
                <div
                  className={cn(
                    'rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground',
                  )}
                >
                  {m.content}
                </div>
                {m.routing && <RoutingCard routing={m.routing} />}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Bot className="size-4" />
              </span>
              <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                <Spinner />
                Routing your prompt…
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
              className="min-h-11 flex-1 resize-none"
              rows={1}
              disabled={sending}
            />
            <Button
              size="lg"
              className="h-11 px-4"
              onClick={send}
              disabled={sending || !input.trim()}
            >
              {sending ? <Spinner /> : <Send className="size-4" />}
              Send
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
