'use client'

import { Cpu, Clock, DollarSign, GitBranch, AlertTriangle } from 'lucide-react'
import type { RoutingInfo } from '@/lib/api'
import { Badge } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

const tierColor: Record<RoutingInfo['tier'], string> = {
  simple: 'bg-chart-1',
  moderate: 'bg-chart-2',
  complex: 'bg-chart-3',
}

const tierBadge: Record<RoutingInfo['tier'], 'simple' | 'moderate' | 'complex'> =
  {
    simple: 'simple',
    moderate: 'moderate',
    complex: 'complex',
  }

export function RoutingCard({ routing }: { routing: RoutingInfo }) {
  const score = Math.max(0, Math.min(100, routing.complexityScore))

  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-primary" />
          <span className="text-sm font-medium">{routing.modelLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={tierBadge[routing.tier]} className="capitalize">
            {routing.tier}
          </Badge>
          <Badge variant="neutral">{routing.provider}</Badge>
          {routing.usedFallback && (
            <Badge variant="warning">
              <AlertTriangle className="size-3" />
              Fallback used
            </Badge>
          )}
        </div>
      </div>

      {/* Complexity gauge */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Complexity score</span>
          <span className="font-mono text-foreground">{score}/100</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              tierColor[routing.tier],
            )}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="size-3" />
            Latency
          </div>
          <p className="mt-1 font-mono text-sm text-foreground">
            {routing.latencyMs}ms
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="flex items-center gap-1 text-muted-foreground">
            <DollarSign className="size-3" />
            Per 1k tok
          </div>
          <p className="mt-1 font-mono text-sm text-foreground">
            ${routing.estimatedCostPer1kTokens}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="flex items-center gap-1 text-muted-foreground">
            <GitBranch className="size-3" />
            Routed by
          </div>
          <p className="mt-1 truncate text-sm text-foreground" title={routing.routedBy}>
            {routing.routedBy}
          </p>
        </div>
      </div>

      {/* Reasons */}
      {routing.reasons?.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">
            Routing reasons
          </p>
          <ul className="mt-1.5 space-y-1">
            {routing.reasons.map((r, i) => (
              <li
                key={i}
                className="flex gap-2 text-xs text-muted-foreground leading-relaxed"
              >
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Fallback reason */}
      {routing.usedFallback && routing.fallbackReason && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-chart-2/40 bg-chart-2/10 p-2.5 text-xs text-chart-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <p className="leading-relaxed">{routing.fallbackReason}</p>
        </div>
      )}
    </div>
  )
}
