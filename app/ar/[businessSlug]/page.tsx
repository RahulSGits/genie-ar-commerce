import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Box, ExternalLink } from 'lucide-react'
import { getBusinessBySlug } from '@/lib/db/repositories/businesses'
import { listPublicProducts, listCategories } from '@/lib/db/repositories/catalog'
import { getTerminology } from '@/config/terminology'
import { Badge, EmptyState } from '@/components/ui'
import { formatMoney, type CurrencyCode } from '@/utils/money'

/** Public catalog for one business. Anonymous, no login. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ businessSlug: string }>
}): Promise<Metadata> {
  const { businessSlug } = await params
  const business = getBusinessBySlug(businessSlug)
  if (!business) return { title: 'Not found' }

  return {
    title: business.name,
    description: business.description ?? `Browse ${business.name} in 3D and AR.`,
    alternates: { canonical: `/ar/${businessSlug}` },
  }
}

export default async function BusinessCatalogPage({
  params,
}: {
  params: Promise<{ businessSlug: string }>
}) {
  const { businessSlug } = await params
  const business = getBusinessBySlug(businessSlug)
  if (!business || business.status !== 'active') notFound()

  const products = listPublicProducts(businessSlug)
  const categories = listCategories(business.id).filter((c) => c.isPublished)
  const terminology = getTerminology(business.category)
  const brand = business.brandColor ?? undefined

  const grouped = categories
    .map((c) => ({ category: c, items: products.filter((p) => p.categoryId === c.id) }))
    .filter((g) => g.items.length > 0)

  const uncategorised = products.filter((p) => !p.categoryId)

  return (
    <main id="main" className="mx-auto w-full max-w-lg px-4 pb-16">
      <header className="safe-t py-6 text-center">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logoUrl} alt="" className="mx-auto mb-3 size-14 rounded-xl object-cover" />
        ) : (
          <div
            className="mx-auto mb-3 grid size-14 place-items-center rounded-xl text-xl font-bold text-white"
            style={{ background: brand ?? 'var(--primary)' }}
            aria-hidden
          >
            {business.name.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{business.name}</h1>
        {business.description && (
          <p className="text-muted-foreground mt-1 text-sm">{business.description}</p>
        )}
        <p className="text-muted-foreground/70 mt-2 text-xs tracking-[0.2em] uppercase">
          {terminology.catalogNavLabel}
        </p>
      </header>

      {products.length === 0 ? (
        <EmptyState
          icon={<Box />}
          title="Nothing published yet"
          description="This business hasn’t published any products for AR viewing."
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(({ category, items }) => (
            <section key={category.id}>
              <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-[0.18em] uppercase">
                {category.name}
              </h2>
              <ProductList items={items} businessSlug={businessSlug} />
            </section>
          ))}

          {uncategorised.length > 0 && (
            <section>
              {grouped.length > 0 && (
                <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-[0.18em] uppercase">
                  More
                </h2>
              )}
              <ProductList items={uncategorised} businessSlug={businessSlug} />
            </section>
          )}
        </div>
      )}

      {(business.websiteUrl || business.orderingUrl) && (
        <div className="mt-10 text-center">
          <a
            href={business.orderingUrl ?? business.websiteUrl ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
          >
            {business.orderingUrl ? 'Order online' : 'Visit website'}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      )}
    </main>
  )
}

function ProductList({
  items,
  businessSlug,
}: {
  items: Array<{
    id: string
    name: string
    slug: string
    shortDescription: string | null
    priceMinor: number | null
    currency: string
    imageUrl: string | null
    modelId: string | null
    isBestseller: boolean
  }>
  businessSlug: string
}) {
  return (
    <ul className="space-y-2">
      {items.map((p) => (
        <li key={p.id}>
          <Link
            href={`/ar/${businessSlug}/${p.slug}`}
            className="hover:border-primary/40 hover:bg-accent/40 flex items-center gap-3 rounded-xl border p-3 transition-colors"
          >
            <div className="bg-muted grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="size-full object-cover" />
              ) : (
                <Box className="text-muted-foreground/40 size-6" aria-hidden />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{p.name}</p>
                {p.isBestseller && (
                  <Badge variant="warning" className="shrink-0">
                    Bestseller
                  </Badge>
                )}
              </div>
              {p.shortDescription && (
                <p className="text-muted-foreground truncate text-xs">{p.shortDescription}</p>
              )}
              <div className="mt-1 flex items-center gap-2">
                {p.priceMinor !== null && (
                  <span className="text-sm font-semibold">
                    {formatMoney({ amount: p.priceMinor, currency: p.currency as CurrencyCode })}
                  </span>
                )}
                {p.modelId && (
                  <Badge variant="success" className="text-[10px]">
                    View in 3D
                  </Badge>
                )}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
