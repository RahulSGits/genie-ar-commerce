import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { requirePermission } from '@/lib/auth/guards'
import { search, SEARCH_KIND_LABELS, type SearchKind } from '@/lib/search'
import { Badge, Card, EmptyState, Input } from '@/components/ui'

export const metadata = { title: 'Search' }
export const dynamic = 'force-dynamic'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const ctx = await requirePermission('products:read')
  const { q = '' } = await searchParams
  const term = q.trim()

  const results = term ? search(ctx.businessId, term, { perKind: 8 }) : null

  const grouped = new Map<SearchKind, typeof results extends null ? never : NonNullable<typeof results>['hits']>()
  for (const hit of results?.hits ?? []) {
    const bucket = grouped.get(hit.kind) ?? []
    bucket.push(hit)
    grouped.set(hit.kind, bucket)
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <form action="/dashboard/search" className="max-w-lg">
          <Input
            type="search"
            name="q"
            defaultValue={term}
            placeholder="Products, campaigns, collections, QR codes, models"
            aria-label="Search"
            autoFocus
          />
        </form>
      </header>

      {!term && (
        <p className="text-muted-foreground text-sm">
          Type at least two characters. Searches names, SKUs, slugs and QR labels.
        </p>
      )}

      {term && results && results.hits.length === 0 && (
        <EmptyState
          icon={<SearchX />}
          title={`Nothing matches “${term}”`}
          description="Check the spelling, or try a SKU or part of a name."
        />
      )}

      {[...grouped.entries()].map(([kind, hits]) => (
        <section key={kind} className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
            {SEARCH_KIND_LABELS[kind]}
          </h2>
          <Card className="divide-y p-0">
            {hits.map((hit) => (
              <Link
                key={`${hit.kind}-${hit.id}`}
                href={hit.href}
                className="hover:bg-accent/50 flex items-center justify-between gap-3 px-4 py-3 transition-colors"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{hit.title}</span>
                  {hit.subtitle && (
                    <span className="text-muted-foreground block truncate text-xs">
                      {hit.subtitle}
                    </span>
                  )}
                </span>
                <Badge variant="muted">{SEARCH_KIND_LABELS[hit.kind]}</Badge>
              </Link>
            ))}
          </Card>
        </section>
      ))}

      {results?.truncated && (
        <p className="text-muted-foreground text-xs">
          Showing the first few matches per type. Narrow the search to see more.
        </p>
      )}
    </div>
  )
}
