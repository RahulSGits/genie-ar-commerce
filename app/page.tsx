import Link from 'next/link'
import {
  ArrowRight, BarChart3, Boxes, Building2, Cpu, Download, Gem, Layers,
  Package, QrCode, Scan, Shirt, Smartphone, Sofa, Sparkles, Users, Utensils, Zap,
} from 'lucide-react'
import { Badge, Button, Card } from '@/components/ui'
import { GenieLogo, GenieMark } from '@/components/brand/GenieLogo'
import TransformDemo from '@/components/marketing/TransformDemo'
import { getCmsSection, getBranding, getActivePromotion } from '@/lib/db/repositories/platform'
import { listPlans } from '@/lib/db/repositories/businesses'
import { formatMoney } from '@/utils/money'

export const dynamic = 'force-dynamic'

/**
 * GENIE marketing homepage.
 *
 * The hero runs on a dark navy field regardless of theme — it is a brand
 * surface, not a document surface, and the violet only sings against dark.
 * Everything below returns to the themed palette.
 *
 * Copy is CMS-overridable where an operator would plausibly want to change it
 * (hero, features, FAQ); structural section copy stays in the component.
 */
export default async function HomePage() {
  const branding = getBranding()
  const hero = getCmsSection<{
    heading: string
    subheading: string
    primaryCta: { label: string; href: string }
    secondaryCta: { label: string; href: string }
  }>('landing_hero')
  const faq = getCmsSection<{ items: Array<{ q: string; a: string }> }>('faq')
  const promo = getActivePromotion()
  const plans = listPlans({ publicOnly: true })

  return (
    <div className="min-h-svh">
      {promo?.showBanner && (
        <div
          className="px-4 py-2.5 text-center text-sm font-medium text-white"
          style={{ background: promo.bannerColor ?? 'var(--primary)' }}
        >
          <span className="font-semibold">{promo.bannerTitle}</span>
          {promo.bannerMessage && <span className="ml-2 opacity-90">{promo.bannerMessage}</span>}
          {promo.bannerCtaUrl && (
            <Link href={promo.bannerCtaUrl} className="ml-3 underline underline-offset-2">
              {promo.bannerCtaLabel ?? 'Learn more'}
            </Link>
          )}
        </div>
      )}

      {/* ── hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[oklch(0.145_0.03_268)] text-white">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(70% 55% at 50% -10%, oklch(0.53 0.245 290 / 0.34), transparent 70%),' +
              'radial-gradient(50% 40% at 85% 10%, oklch(0.58 0.19 258 / 0.20), transparent 70%)',
          }}
          aria-hidden
        />

        <header className="safe-t relative z-10">
          <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <Link href="/" aria-label={`${branding.name} home`}>
              <GenieLogo tone="onDark" />
            </Link>
            <div className="flex items-center gap-1 sm:gap-2">
              <Button asChild variant="ghost" size="sm" className="hidden text-white/70 hover:bg-white/10 hover:text-white sm:inline-flex">
                <Link href="#industries">Industries</Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="hidden text-white/70 hover:bg-white/10 hover:text-white sm:inline-flex">
                <Link href="/pricing">Pricing</Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="text-white/70 hover:bg-white/10 hover:text-white">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Get started</Link>
              </Button>
            </div>
          </nav>
        </header>

        <div className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-12 sm:pb-24 sm:pt-16">
          <div className="mx-auto max-w-3xl text-center">
            <Badge className="mb-5 border-white/15 bg-white/10 text-white">
              <Sparkles className="size-3" aria-hidden />
              Upload. Generate. Scan. Experience.
            </Badge>

            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-[3.4rem] md:leading-[1.05]">
              {hero?.heading ?? 'Turn Any Product Into 3D & AR.'}
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-white/60">
              {hero?.subheading ??
                'Upload a product image. GENIE turns it into an immersive 3D experience, generates a shareable QR code, and lets customers view it in AR — no app, no signup.'}
            </p>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href={hero?.primaryCta.href ?? '/dashboard/create'}>
                  {hero?.primaryCta.label ?? 'Create Your First 3D Product'}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="#how">See How It Works</Link>
              </Button>
            </div>
          </div>

          <div className="mt-14">
            <TransformDemo />
          </div>
        </div>
      </section>

      <main id="main">
        {/* ── how it works ───────────────────────────────────────────────── */}
        <section id="how" className="border-b px-4 py-20">
          <div className="mx-auto max-w-5xl">
            <SectionHeading
              eyebrow="How GENIE works"
              title="Four steps from photo to customer's table"
            />
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['01', 'Upload', 'Add a product or menu image, plus the details customers see.', ImageStep],
                ['02', 'Generate', 'GENIE builds an optimised 3D asset sized to the real product.', Cpu],
                ['03', 'Scan', 'A QR code and a public product page are created automatically.', QrCode],
                ['04', 'Experience', 'Customers view it in 3D, then place it in their own space.', Smartphone],
              ].map(([num, title, body, Icon]) => {
                const I = Icon as typeof Cpu
                return (
                  <li key={num as string}>
                    <div className="mb-4 flex items-center gap-3">
                      <span className="text-primary text-xs font-bold tracking-widest">{num as string}</span>
                      <span className="bg-border h-px flex-1" aria-hidden />
                    </div>
                    <I className="text-primary mb-3 size-5" aria-hidden />
                    <h3 className="font-semibold">{title as string}</h3>
                    <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                      {body as string}
                    </p>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>

        {/* ── industries ─────────────────────────────────────────────────── */}
        <section id="industries" className="bg-muted/30 border-b px-4 py-20">
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Industry solutions"
              title="One platform, every product category"
              body="GENIE is not a restaurant tool with other verticals bolted on. Terminology, placement behaviour and default sizing adapt to what you sell."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [Utensils, 'Restaurants', 'Let guests see the dish before they order. Fewer surprises, bigger baskets.'],
                [Shirt, 'Fashion', 'Show fabric, cut and drape from every angle instead of one flat photo.'],
                [Sofa, 'Furniture', 'Customers place the piece in their own room at true size before buying.'],
                [Gem, 'Jewelry', 'Close inspection of detail that a product photo flattens away.'],
                [Package, 'Retail', 'Turn a shelf label into an interactive product experience.'],
                [Cpu, 'Electronics', 'Ports, dimensions and finish, explorable rather than described.'],
                [Building2, 'Hospitality', 'Rooms, amenities and menus as spatial experiences.'],
                [Boxes, 'E-commerce', 'Cut returns by showing scale and finish honestly up front.'],
              ].map(([Icon, title, body]) => {
                const I = Icon as typeof Cpu
                return (
                  <Card key={title as string} className="hover:border-primary/40 p-5 transition-colors">
                    <I className="text-primary mb-3 size-5" aria-hidden />
                    <h3 className="font-semibold">{title as string}</h3>
                    <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                      {body as string}
                    </p>
                  </Card>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── features ───────────────────────────────────────────────────── */}
        <section className="border-b px-4 py-20">
          <div className="mx-auto max-w-5xl">
            <SectionHeading eyebrow="Features" title="Everything the pipeline needs" />
            <div className="mt-12 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
              {[
                [Cpu, 'AI 3D generation', 'Image to optimised GLB through a pluggable provider.'],
                [Scan, 'WebAR', 'WebXR, Scene Viewer and iOS Quick Look, with a 3D fallback everywhere.'],
                [QrCode, 'QR codes', 'Re-pointable without reprinting. Scan counts per code.'],
                [Boxes, '3D viewer', 'Rotate, zoom and inspect at true physical scale.'],
                [Smartphone, 'Product pages', 'Mobile-first public pages that need no app or signup.'],
                [Layers, 'Collections', 'Group products into menus, drops and catalogs.'],
                [BarChart3, 'Analytics', 'Scans, AR sessions and CTA clicks as one funnel.'],
                [Download, 'Asset downloads', 'GLB, QR and print-ready sheets for signage.'],
                [Users, 'Team access', 'Owner, admin and member roles per workspace.'],
              ].map(([Icon, title, body]) => {
                const I = Icon as typeof Cpu
                return (
                  <div key={title as string}>
                    <I className="text-primary mb-2.5 size-5" aria-hidden />
                    <h3 className="text-sm font-semibold">{title as string}</h3>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      {body as string}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── speed ──────────────────────────────────────────────────────── */}
        <section className="border-b px-4 py-20">
          <div className="mx-auto max-w-3xl text-center">
            <Zap className="text-primary mx-auto mb-5 size-7" aria-hidden />
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              From image to interactive product experience in minutes.
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-pretty">
              Upload, generate, publish, print the code. How long generation itself takes depends
              on the provider you connect — GENIE shows you real progress rather than a spinner
              that means nothing.
            </p>
          </div>
        </section>

        {/* ── pricing ────────────────────────────────────────────────────── */}
        <section className="bg-muted/30 border-b px-4 py-20">
          <div className="mx-auto max-w-5xl">
            <SectionHeading
              eyebrow="Pricing"
              title="Simple, invoiced directly"
              body="No card required. We invoice you — bank transfer, UPI or cash."
            />
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {plans.map((plan, i) => (
                <Card key={plan.id} className={i === 1 ? 'border-primary relative shadow-md' : 'relative'}>
                  {i === 1 && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">Most popular</Badge>
                  )}
                  <div className="p-6">
                    <h3 className="font-semibold">{plan.name}</h3>
                    <p className="text-muted-foreground mt-1 min-h-10 text-sm">{plan.description}</p>
                    <p className="mt-4">
                      <span className="text-3xl font-bold tracking-tight">
                        {formatMoney({ amount: plan.priceMinor, currency: plan.currency })}
                      </span>
                      <span className="text-muted-foreground text-sm">/month</span>
                    </p>
                    {plan.setupFeeMinor > 0 && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        + {formatMoney({ amount: plan.setupFeeMinor, currency: plan.currency })} one-time setup
                      </p>
                    )}
                    <ul className="text-muted-foreground mt-5 space-y-2 text-sm">
                      <li>✓ {plan.limits.maxProducts ?? 'Unlimited'} products</li>
                      <li>✓ {plan.limits.maxArModels ?? 'Unlimited'} 3D models</li>
                      <li>✓ {plan.limits.maxQrCodes ?? 'Unlimited'} QR codes</li>
                      {plan.features.advanced_analytics && <li>✓ Advanced analytics</li>}
                      {plan.features.white_label && <li>✓ White label</li>}
                    </ul>
                    <Button asChild className="mt-6 w-full" variant={i === 1 ? 'default' : 'outline'}>
                      <Link href="/signup">Get started</Link>
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── faq ────────────────────────────────────────────────────────── */}
        {faq && (
          <section className="border-b px-4 py-20">
            <div className="mx-auto max-w-2xl">
              <SectionHeading eyebrow="FAQ" title="Questions worth asking" />
              <div className="mt-10 space-y-3">
                {faq.items.map((item) => (
                  <details key={item.q} className="group rounded-xl border p-4">
                    <summary className="cursor-pointer list-none font-medium marker:hidden">
                      <span className="flex items-center justify-between gap-3">
                        {item.q}
                        <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                      </span>
                    </summary>
                    <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── closing CTA ────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[oklch(0.145_0.03_268)] px-4 py-24 text-white">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(60% 60% at 50% 50%, oklch(0.53 0.245 290 / 0.28), transparent 70%)',
            }}
            aria-hidden
          />
          <div className="relative mx-auto max-w-2xl text-center">
            <GenieMark className="text-primary mx-auto mb-6 size-10" />
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Ready to make your products immersive?
            </h2>
            <p className="mt-4 text-white/60">
              Start with one product. See it on your own table in the next five minutes.
            </p>
            <Button asChild size="lg" className="mt-8">
              <Link href="/signup">
                Create with GENIE
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="safe-b border-t px-4 py-12">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-center">
          <GenieLogo />
          <p className="text-muted-foreground text-xs">{branding.tagline}</p>
          <div className="text-muted-foreground flex flex-wrap justify-center gap-4 text-xs">
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
            <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/legal/refunds" className="hover:text-foreground">Refunds</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string
  title: string
  body?: string
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-primary mb-3 text-xs font-semibold tracking-[0.18em] uppercase">
        {eyebrow}
      </p>
      <h2 className="text-3xl font-bold tracking-tight text-balance">{title}</h2>
      {body && <p className="text-muted-foreground mt-3 text-pretty">{body}</p>}
    </div>
  )
}

/** Local alias so the step list can carry an icon in a tuple without a cast dance. */
function ImageStep(props: React.ComponentProps<typeof Cpu>) {
  return <Scan {...props} />
}
