import Link from 'next/link'
import {
  Flame,
  KeyRound,
  Route,
  PiggyBank,
  Zap,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react'
import { Card } from '@/components/ui/primitives'

const models = [
  'Groq Llama',
  'Claude Haiku',
  'Claude Sonnet',
  'Claude Opus',
  'Gemini Flash',
  'Gemini Pro',
  'Mistral Small',
  'Mistral Large',
]

const features = [
  {
    icon: Route,
    title: 'Automatic routing',
    body: 'Every prompt is scored for complexity and sent to the cheapest model that can handle it — from fast 8B models to frontier reasoning.',
  },
  {
    icon: PiggyBank,
    title: 'Real cost savings',
    body: 'Trivial prompts never touch a top-tier model. Track exactly how much you save versus always calling the most expensive option.',
  },
  {
    icon: KeyRound,
    title: 'One key to rule them all',
    body: 'Generate a single Forge key and reach Groq, Anthropic, Gemini and Mistral without juggling separate provider credentials.',
  },
  {
    icon: ShieldCheck,
    title: 'Graceful fallbacks',
    body: 'If a provider fails, the gateway transparently falls back and tells you exactly why — right in the response.',
  },
]

export default function OverviewPage() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-14 sm:px-10 lg:py-20">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, var(--color-primary) 0, transparent 45%)',
          }}
        />
        <div className="relative mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Flame className="size-3.5" />
            OpenRouter-style AI gateway
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            One key, every model, automatic routing
          </h1>
          <p className="mt-4 text-lg text-muted-foreground text-pretty">
            API Forge routes each prompt to the cheapest, fastest model that can
            actually handle it — so you ship faster and spend less, with a single
            API key.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/keys"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Generate your key
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/playground"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-6 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Zap className="size-4" />
              Try the playground
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {models.map((m) => (
              <span
                key={m}
                className="rounded-full border border-border bg-muted/50 px-3 py-1 font-mono text-xs text-muted-foreground"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <p className="mt-2 text-muted-foreground">
            Three steps from prompt to the perfectly-sized model.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              step: '01',
              title: 'Generate a Forge key',
              body: 'Create a single key from the dashboard and drop it into your app.',
            },
            {
              step: '02',
              title: 'Send your prompts',
              body: 'Call one chat/completions endpoint with model set to "auto".',
            },
            {
              step: '03',
              title: 'Get routed intelligently',
              body: 'Forge analyzes complexity and picks the optimal provider automatically.',
            },
          ].map((s) => (
            <Card key={s.step} className="p-6">
              <span className="font-mono text-sm text-primary">{s.step}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {s.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* Features */}
      <section>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((f) => {
            const Icon = f.icon
            return (
              <Card key={f.title} className="flex gap-4 p-6">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    {f.body}
                  </p>
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="rounded-3xl border border-border bg-gradient-to-b from-card to-background px-6 py-12 text-center sm:px-10">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          Ready to stop overpaying for simple prompts?
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-muted-foreground text-pretty">
          Generate your first Forge key and watch the savings add up in the
          analytics dashboard.
        </p>
        <Link
          href="/keys"
          className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Get started
          <ArrowRight className="size-4" />
        </Link>
      </section>
    </div>
  )
}
