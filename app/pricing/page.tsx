import Link from 'next/link'
import { ArrowRight, Banknote, CreditCard, FileText, Sparkles } from 'lucide-react'
import { Badge, Button, Card } from '@/components/ui'
import PricingTable from '@/components/marketing/PricingTable'
import { listPlans } from '@/lib/db/repositories/businesses'
import {
  getActivePromotion,
  getBranding,
  getCmsSection,
  getTaxSettings,
} from '@/lib/db/repositories/platform'

export const metadata = {
  title: 'Pricing',
  description:
    'Plans, setup fees and limits for AR product pages. No card required — we invoice you directly and you pay by bank transfer or UPI.',
}
export const dynamic = 'force-dynamic'

/**
 * Public pricing page.
 *
 * The billing model is manual on purpose — there is no payment processor in the
 * system — so this page has to say that plainly rather than imply a checkout
 * that does not exist.
 */
export default async function PricingPage() {
  const branding = getBranding()
  const plans = listPlans({ publicOnly: true })
  const promo = getActivePromotion()
  const faq = getCmsSection<{ items: Array<{ q: string; a: string }> }>('faq')
  const tax = getTaxSettings()

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

      <header className="safe-t sticky top-0 z-40 border-b bg-background/80 backdrop-blur-lg">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="bg-primary grid size-8 place-items-center rounded-lg text-base">
              {branding.faviconEmoji ?? '📦'}
            </span>
            {branding.name}
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/pricing">Pricing</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* ── header ────────────────────────────────────────────────────── */}
        <section className="px-4 pt-16 pb-10 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="secondary" className="mb-5">
              <Sparkles className="size-3" aria-hidden /> No card required
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              Pricing that fits one shop or fifty
            </h1>
            <p className="text-muted-foreground mx-auto mt-5 max-w-2xl text-lg text-pretty">
              A one-time setup fee per 3D model, then a monthly subscription for as long as your AR
              pages stay live. Cancel whenever — your printed codes keep working until the period
              ends.
            </p>
          </div>
        </section>

        {/* ── promotion ─────────────────────────────────────────────────── */}
        {promo && (
          <section className="px-4 pb-6">
            <div className="mx-auto max-w-5xl">
              <Card className="border-primary/30 bg-primary/5 flex flex-wrap items-center gap-3 p-5">
                <Sparkles className="text-primary size-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{promo.bannerTitle ?? promo.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {promo.bannerMessage ??
                      promo.description ??
                      (promo.discountType === 'percentage'
                        ? `${promo.discountValue}% off your subscription.`
                        : 'A discount is currently running.')}
                  </p>
                </div>
                {promo.couponCode && (
                  <Badge variant="outline" className="font-mono tracking-wider">
                    {promo.couponCode}
                  </Badge>
                )}
              </Card>
            </div>
          </section>
        )}

        {/* ── plans ─────────────────────────────────────────────────────── */}
        <section className="px-4 pb-16">
          <div className="mx-auto max-w-5xl">
            <PricingTable plans={plans} />
            <p className="text-muted-foreground mt-6 text-center text-xs">
              Prices are per business.{' '}
              {tax.enabled
                ? `${tax.name} at ${tax.percent}% is added on the invoice.`
                : 'Taxes, where applicable, are added on the invoice.'}
            </p>
          </div>
        </section>

        {/* ── how billing works ─────────────────────────────────────────── */}
        <section className="bg-muted/30 border-y px-4 py-16" id="billing">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight">How billing works</h2>
            <p className="text-muted-foreground mx-auto mt-2 max-w-2xl text-center text-sm">
              There is no card form anywhere in this product. We invoice you and you pay the way you
              already pay your other suppliers.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                {
                  icon: CreditCard,
                  title: 'No card on file',
                  body: 'Signing up never asks for card details, and nothing is charged automatically. You are never billed by surprise.',
                },
                {
                  icon: FileText,
                  title: 'We invoice you',
                  body: 'Each period we raise an invoice you can see in your dashboard, with the setup fees and subscription itemised.',
                },
                {
                  icon: Banknote,
                  title: 'Pay by transfer or UPI',
                  body: 'Settle by bank transfer, UPI or cash. We record the payment against the invoice and mark it paid.',
                },
              ].map((item) => (
                <Card key={item.title} className="p-6">
                  <item.icon className="text-primary mb-3 size-5" aria-hidden />
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                    {item.body}
                  </p>
                </Card>
              ))}
            </div>

            <p className="text-muted-foreground mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed">
              If an invoice runs late your AR pages stay live. A code printed on a table going dead
              mid-service is a worse outcome for everyone than a payment reminder, so suspension is
              a deliberate conversation, never an automatic one.
            </p>
          </div>
        </section>

        {/* ── faq ───────────────────────────────────────────────────────── */}
        {faq && faq.items.length > 0 && (
          <section className="px-4 py-16">
            <div className="mx-auto max-w-2xl">
              <h2 className="text-center text-2xl font-bold tracking-tight">
                Questions before you start
              </h2>
              <div className="mt-8 space-y-3">
                {faq.items.map((item) => (
                  <details key={item.q} className="group rounded-xl border p-4">
                    <summary className="cursor-pointer list-none font-medium marker:hidden">
                      <span className="flex items-center justify-between gap-3">
                        {item.q}
                        <span className="text-muted-foreground transition-transform group-open:rotate-45">
                          +
                        </span>
                      </span>
                    </summary>
                    <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── cta ───────────────────────────────────────────────────────── */}
        <section className="border-t px-4 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight">Start with one product</h2>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              Put one dish or one item into AR, print its code, and watch what happens on a real
              table before you commit to a full catalogue.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">
                  Create your account
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/ar/urban-bites/signature-burger">See a live AR page</Link>
              </Button>
            </div>
            {branding.supportEmail && (
              <p className="text-muted-foreground mt-5 text-xs">
                Need a plan that isn’t listed? Write to{' '}
                <a href={`mailto:${branding.supportEmail}`} className="underline underline-offset-2">
                  {branding.supportEmail}
                </a>
                .
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="safe-b border-t px-4 py-10">
        <div className="text-muted-foreground mx-auto max-w-5xl text-center text-sm">
          <p className="font-medium text-foreground">{branding.name}</p>
          <p className="mt-1 text-xs">{branding.tagline}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-4 text-xs">
            <Link href="/" className="hover:text-foreground">Home</Link>
            <Link href="/login" className="hover:text-foreground">Business sign in</Link>
            <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/legal/refunds" className="hover:text-foreground">Refunds</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
