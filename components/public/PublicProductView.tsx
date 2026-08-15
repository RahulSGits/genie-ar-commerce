'use client'

import { useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ExternalLink, Leaf, ShieldAlert } from 'lucide-react'
import ProductArExperience, { ProductPrice } from '@/components/ar/ProductArExperience'
import { Badge, Button } from '@/components/ui'
import { deviceProfile } from '@/lib/ar/capabilities'
import { formatMoney, type CurrencyCode } from '@/utils/money'
import type { PublicArProduct } from '@/types/ar'
import type { DietTag } from '@/types/domain'

type Sibling = {
  id: string
  name: string
  slug: string
  priceMinor: number | null
  currency: string
  imageUrl: string | null
  hasModel: boolean
}

type Props = {
  product: PublicArProduct
  allergens: string[]
  diet: DietTag | null
  tags: string[]
  others: Sibling[]
  showFoodFields: boolean
}

/**
 * The customer-facing product page.
 *
 * Mobile-first by construction: single column, thumb-reachable actions, and a
 * sticky CTA that stays available while the customer explores the model.
 */
export default function PublicProductView({
  product,
  allergens,
  diet,
  tags,
  others,
  showFoodFields,
}: Props) {
  const searchParams = useSearchParams()
  const qrCodeId = searchParams.get('qr')
  const sessionKey = useRef<string>('')

  if (!sessionKey.current && typeof crypto !== 'undefined') {
    sessionKey.current = crypto.randomUUID()
  }

  /** Sends a funnel event. Best-effort — never blocks or interrupts the page. */
  const track = useCallback(
    (eventType: string) => {
      const profile = deviceProfile()
      const payload = JSON.stringify({
        businessSlug: product.business.slug,
        productId: product.id,
        qrCodeId: qrCodeId ?? null,
        eventType,
        deviceType: profile.deviceType,
        browser: profile.browser,
        os: profile.os,
        sessionKey: sessionKey.current || null,
      })

      // sendBeacon survives the page being backgrounded by an AR handoff or an
      // outbound CTA — a plain fetch would be cancelled mid-flight.
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics/event', new Blob([payload], { type: 'application/json' }))
      } else {
        void fetch('/api/analytics/event', {
          method: 'POST',
          body: payload,
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {})
      }
    },
    [product.business.slug, product.id, qrCodeId],
  )

  useEffect(() => {
    track('product_loaded')
  }, [track])

  const brand = product.business.brandColor ?? undefined

  return (
    <main id="main" className="mx-auto flex min-h-svh w-full max-w-lg flex-col px-4 pb-28">
      {/* ── business header ─────────────────────────────────────────────── */}
      <header className="safe-t flex items-center gap-3 py-4">
        {product.business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.business.logoUrl}
            alt=""
            className="size-9 rounded-lg object-cover"
          />
        ) : (
          <div
            className="grid size-9 place-items-center rounded-lg text-sm font-bold text-white"
            style={{ background: brand ?? 'var(--primary)' }}
            aria-hidden
          >
            {product.business.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{product.business.name}</p>
          <Link
            href={`/ar/${product.business.slug}`}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            View all products
          </Link>
        </div>
      </header>

      {/* ── 3D / AR ─────────────────────────────────────────────────────── */}
      <ProductArExperience
        product={product}
        onEvent={(e) => track(e)}
      />

      {/* ── details ─────────────────────────────────────────────────────── */}
      <section className="mt-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl leading-tight font-bold tracking-tight">{product.name}</h1>
          {showFoodFields && diet && (
            <span
              className="mt-1.5 grid size-5 shrink-0 place-items-center rounded border-[1.5px]"
              style={{ borderColor: diet === 'veg' ? '#2e9e4f' : diet === 'egg' ? '#e0a020' : '#c8392b' }}
              aria-label={diet === 'veg' ? 'Vegetarian' : diet === 'egg' ? 'Contains egg' : 'Non-vegetarian'}
              title={diet === 'veg' ? 'Vegetarian' : diet === 'egg' ? 'Contains egg' : 'Non-vegetarian'}
            >
              <span
                className="size-2 rounded-full"
                style={{ background: diet === 'veg' ? '#2e9e4f' : diet === 'egg' ? '#e0a020' : '#c8392b' }}
              />
            </span>
          )}
        </div>

        <div className="mt-2">
          <ProductPrice
            priceMinor={product.priceMinor}
            compareAtMinor={product.compareAtPriceMinor}
            currency={product.currency}
          />
        </div>

        {product.description && (
          <p className="text-muted-foreground mt-3 leading-relaxed">{product.description}</p>
        )}

        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="capitalize">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {showFoodFields && allergens.length > 0 && (
          <p className="text-muted-foreground mt-3 flex items-start gap-1.5 text-xs">
            <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-medium">Contains:</strong> {allergens.join(', ')}
            </span>
          </p>
        )}

        {product.dimensions && (
          <p className="text-muted-foreground mt-2 text-xs">
            {product.dimensions.width} × {product.dimensions.height} × {product.dimensions.depth}{' '}
            {product.dimensions.unit}
          </p>
        )}
      </section>

      {/* ── siblings ────────────────────────────────────────────────────── */}
      {others.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">More from {product.business.name}</h2>
          <div className="scroll-x -mx-4 flex gap-3 px-4 pb-2">
            {others.map((o) => (
              <Link
                key={o.id}
                href={`/ar/${product.business.slug}/${o.slug}`}
                className="hover:border-primary/40 w-32 shrink-0 rounded-xl border p-2 transition-colors"
              >
                <div className="bg-muted mb-2 grid aspect-square place-items-center overflow-hidden rounded-lg">
                  {o.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="text-muted-foreground/50 text-xs">
                      {o.hasModel ? '3D' : '—'}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs font-medium">{o.name}</p>
                {o.priceMinor !== null && (
                  <p className="text-muted-foreground text-xs">
                    {formatMoney({ amount: o.priceMinor, currency: o.currency as CurrencyCode })}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="text-muted-foreground/70 mt-8 text-center text-[11px]">
        3D experience by ARView Commerce · nothing from your camera leaves your device
      </p>

      {/* ── sticky CTA ──────────────────────────────────────────────────── */}
      {product.ctaUrl && (
        <div className="safe-b bg-background/85 fixed inset-x-0 bottom-0 border-t px-4 py-3 backdrop-blur-lg">
          <div className="mx-auto max-w-lg">
            <Button
              asChild
              size="lg"
              className="w-full"
              style={brand ? { backgroundColor: brand } : undefined}
              onClick={() => track('cta_clicked')}
            >
              <a
                href={product.ctaUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('cta_clicked')}
              >
                {product.ctaLabel ?? 'Order Now'}
                <ExternalLink className="size-4" aria-hidden />
              </a>
            </Button>
          </div>
        </div>
      )}
    </main>
  )
}

export { Leaf }
