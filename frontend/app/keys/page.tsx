'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  KeyRound,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
  Plus,
} from 'lucide-react'
import { api, ApiError, type GeneratedKey, type MaskedKey } from '@/lib/api'
import { keyStore } from '@/lib/key-store'
import { useToast } from '@/components/toast'
import { PageHeader } from '@/components/page-header'
import { Modal } from '@/components/modal'
import { ErrorBanner } from '@/components/error-banner'
import { Button } from '@/components/ui/button'
import {
  Card,
  Input,
  Label,
  Spinner,
  Skeleton,
  Badge,
} from '@/components/ui/primitives'

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          toast({ variant: 'success', title: 'Copied to clipboard' })
          setTimeout(() => setCopied(false), 2000)
        } catch {
          toast({ variant: 'error', title: 'Could not copy' })
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

export default function KeysPage() {
  const { toast } = useToast()
  const { data, error, isLoading, mutate } = useSWR('keys', () =>
    api.listKeys(),
  )

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<GeneratedKey | null>(null)
  const [toRevoke, setToRevoke] = useState<MaskedKey | null>(null)
  const [revoking, setRevoking] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const key = await api.createKey(name.trim() || undefined)
      keyStore.add({
        id: key.id,
        name: key.name,
        key: key.key,
        createdAt: key.createdAt,
      })
      setNewKey(key)
      setName('')
      toast({ variant: 'success', title: 'API key generated' })
      mutate()
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Failed to generate key',
        description: err instanceof ApiError ? err.message : 'Unknown error',
      })
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke() {
    if (!toRevoke) return
    setRevoking(true)
    try {
      await api.revokeKey(toRevoke.id)
      keyStore.remove(toRevoke.id)
      toast({ variant: 'success', title: 'Key revoked' })
      setToRevoke(null)
      mutate()
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Failed to revoke key',
        description: err instanceof ApiError ? err.message : 'Unknown error',
      })
    } finally {
      setRevoking(false)
    }
  }

  const keys = data?.keys ?? []

  return (
    <div className="space-y-8">
      <PageHeader
        title="API Keys"
        description="Generate Forge keys for your apps and manage their access. A key's full value is shown only once at creation."
      />

      {/* Generate form */}
      <Card className="p-6">
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Label htmlFor="key-name">Key name (optional)</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. production-app"
              className="mt-2"
              disabled={creating}
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={creating}
            className="h-10 px-5"
          >
            {creating ? <Spinner /> : <Plus className="size-4" />}
            Generate Key
          </Button>
        </form>
      </Card>

      {/* Keys table */}
      <div>
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
          Your keys{keys.length > 0 && ` (${keys.length})`}
        </h2>

        {error && (
          <ErrorBanner
            message={
              error instanceof ApiError
                ? error.message
                : 'Failed to load keys.'
            }
          />
        )}

        {isLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        )}

        {!isLoading && !error && keys.length === 0 && (
          <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <KeyRound className="size-6" />
            </span>
            <p className="font-medium">No keys yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Generate your first Forge key above to start routing prompts
              across models.
            </p>
          </Card>
        )}

        {!isLoading && keys.length > 0 && (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Key</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium">Usage</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr
                      key={k.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-4 font-medium">
                        {k.name || (
                          <span className="text-muted-foreground">Untitled</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                          {k.maskedKey}
                        </code>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-muted-foreground">
                        {new Date(k.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-muted-foreground">
                        <div className="flex flex-col gap-0.5 text-xs">
                          <span>{k.usage.requests} requests</span>
                          <span className="font-mono">
                            {k.usage.inputTokens}in / {k.usage.outputTokens}out
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {k.revoked ? (
                          <Badge variant="danger">Revoked</Badge>
                        ) : (
                          <Badge variant="success">Active</Badge>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={k.revoked}
                          onClick={() => setToRevoke(k)}
                        >
                          <Trash2 className="size-3.5" />
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* New key modal — shown ONCE */}
      <Modal
        open={!!newKey}
        onClose={() => setNewKey(null)}
        labelledBy="new-key-title"
      >
        {newKey && (
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <KeyRound className="size-5" />
              </span>
              <div>
                <h2 id="new-key-title" className="font-semibold">
                  Key created
                </h2>
                <p className="text-sm text-muted-foreground">
                  {newKey.name || 'Untitled key'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-start gap-2 rounded-lg border border-chart-2/40 bg-chart-2/10 p-3 text-sm text-chart-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p className="leading-relaxed">
                Save this now — you won&apos;t be able to see the full key
                again.
              </p>
            </div>

            <div className="mt-4">
              <Label>Your Forge key</Label>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                  {newKey.key}
                </code>
              </div>
              <div className="mt-3 flex justify-end">
                <CopyButton value={newKey.key} />
              </div>
            </div>

            <Button
              className="mt-4 w-full"
              size="lg"
              onClick={() => setNewKey(null)}
            >
              I&apos;ve saved my key
            </Button>
          </div>
        )}
      </Modal>

      {/* Revoke confirmation */}
      <Modal
        open={!!toRevoke}
        onClose={() => !revoking && setToRevoke(null)}
        labelledBy="revoke-title"
      >
        {toRevoke && (
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <Trash2 className="size-5" />
              </span>
              <h2 id="revoke-title" className="font-semibold">
                Revoke this key?
              </h2>
            </div>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Any application using{' '}
              <span className="font-medium text-foreground">
                {toRevoke.name || 'this key'}
              </span>{' '}
              (<code className="font-mono text-xs">{toRevoke.maskedKey}</code>)
              will stop working immediately. This cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                size="lg"
                disabled={revoking}
                onClick={() => setToRevoke(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                size="lg"
                disabled={revoking}
                onClick={handleRevoke}
              >
                {revoking ? <Spinner /> : <Trash2 className="size-4" />}
                Revoke key
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
