'use client'

import useSWR from 'swr'
import {
  Activity,
  ArrowDownUp,
  TrendingDown,
  RefreshCw,
  Coins,
} from 'lucide-react'
import { api, ApiError, type Stats } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { ErrorBanner } from '@/components/error-banner'
import { Button } from '@/components/ui/button'
import { Card, Skeleton } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

const TIERS = [
  { key: 'simple', label: 'Simple', color: 'var(--color-chart-1)' },
  { key: 'moderate', label: 'Moderate', color: 'var(--color-chart-2)' },
  { key: 'complex', label: 'Complex', color: 'var(--color-chart-3)' },
] as const

function fmtUSD(n: number) {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: n < 1 ? 3 : 2,
    maximumFractionDigits: n < 1 ? 4 : 2,
  })}`
}

function fmtNum(n: number) {
  return n.toLocaleString()
}

function Donut({ stats }: { stats: Stats }) {
  const total =
    stats.byTier.simple + stats.byTier.moderate + stats.byTier.complex
  let acc = 0
  const segments = TIERS.map((t) => {
    const value = stats.byTier[t.key]
    const start = total ? (acc / total) * 360 : 0
    acc += value
    const end = total ? (acc / total) * 360 : 0
    return { ...t, value, start, end }
  })

  const gradient = total
    ? `conic-gradient(${segments
        .map((s) => `${s.color} ${s.start}deg ${s.end}deg`)
        .join(', ')})`
    : 'conic-gradient(var(--color-muted) 0deg 360deg)'

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative shrink-0">
        <div
          className="size-40 rounded-full"
          style={{ background: gradient }}
          role="img"
          aria-label="Requests by tier"
        />
        <div className="absolute inset-4 flex flex-col items-center justify-center rounded-full bg-card">
          <span className="text-2xl font-semibold">{fmtNum(total)}</span>
          <span className="text-xs text-muted-foreground">requests</span>
        </div>
      </div>
      <div className="flex-1 space-y-3">
        {segments.map((s) => {
          const pct = total ? Math.round((s.value / total) * 100) : 0
          return (
            <div key={s.key} className="flex items-center gap-3">
              <span
                className="size-3 shrink-0 rounded-sm"
                style={{ background: s.color }}
              />
              <span className="w-20 text-sm">{s.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: s.color }}
                />
              </div>
              <span className="w-24 text-right text-sm text-muted-foreground">
                {fmtNum(s.value)}{' '}
                <span className="text-xs">({pct}%)</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Activity
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-sm">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  )
}

export default function StatsPage() {
  const { data, error, isLoading, mutate, isValidating } = useSWR(
    'stats',
    () => api.stats(),
    { refreshInterval: 15000 },
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description="Aggregate usage across all your keys, and how much smart routing is saving you versus always calling the top-tier model."
        action={
          <Button variant="outline" onClick={() => mutate()}>
            <RefreshCw
              className={cn('size-4', isValidating && 'animate-spin')}
            />
            Refresh
          </Button>
        }
      />

      {error && (
        <ErrorBanner
          message={
            error instanceof ApiError ? error.message : 'Failed to load stats.'
          }
        />
      )}

      {isLoading && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      )}

      {data && (
        <>
          {/* Savings highlight */}
          <Card className="relative overflow-hidden border-primary/30 bg-primary/5 p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-primary">
                  <TrendingDown className="size-5" />
                  <span className="text-sm font-medium">
                    Estimated savings from smart routing
                  </span>
                </div>
                <p className="mt-3 text-4xl font-semibold tracking-tight">
                  {fmtUSD(data.estimatedSavingsUSD)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.estimatedSavingsPercent}% cheaper than always using the
                  top-tier model
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Actual spend</p>
                  <p className="mt-1 text-lg font-semibold">
                    {fmtUSD(data.estimatedActualCostUSD)}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">
                    If always top-tier
                  </p>
                  <p className="mt-1 text-lg font-semibold text-muted-foreground line-through">
                    {fmtUSD(data.estimatedBaselineCostUSD_ifAlwaysTopTier)}
                  </p>
                </div>
              </div>
            </div>
            {/* savings bar */}
            <div className="mt-6">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${Math.min(100, data.estimatedSavingsPercent)}%`,
                  }}
                />
              </div>
            </div>
          </Card>

          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Activity}
              label="Total requests"
              value={fmtNum(data.totalRequests)}
            />
            <StatCard
              icon={ArrowDownUp}
              label="Input tokens"
              value={fmtNum(data.totalInputTokens)}
            />
            <StatCard
              icon={ArrowDownUp}
              label="Output tokens"
              value={fmtNum(data.totalOutputTokens)}
            />
            <StatCard
              icon={Coins}
              label="Total tokens"
              value={fmtNum(data.totalInputTokens + data.totalOutputTokens)}
            />
          </div>

          {/* Tier breakdown */}
          <Card className="p-6">
            <h2 className="text-base font-semibold tracking-tight">
              Requests by complexity tier
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              How your prompts distribute across simple, moderate and complex
              routing tiers.
            </p>
            <div className="mt-6">
              <Donut stats={data} />
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
