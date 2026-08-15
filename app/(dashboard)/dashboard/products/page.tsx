import Link from 'next/link'
import { Boxes, Eye, EyeOff, Plus, Search } from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { listProducts } from '@/lib/db/repositories/catalog'
import { setProductStatusAction } from '@/lib/actions/dashboard'
import { getTerminology } from '@/config/terminology'
import { formatMoney } from '@/utils/money'
import {
  Badge, Button, Card, EmptyState, Input, Select,
  TBody, TD, TH, THead, TR, Table,
} from '@/components/ui'
import type { ProductStatus } from '@/types/domain'

export const metadata = { title: 'Products' }
export const dynamic = 'force-dynamic'

const STATUS_FILTERS = ['all', 'draft', 'published', 'archived'] as const

const STATUS_VARIANT: Record<ProductStatus, 'success' | 'warning' | 'muted'> = {
  published: 'success',
  draft: 'warning',
  archived: 'muted',
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const terminology = getTerminology(business.category)

  const sp = await searchParams
  const q = sp.q?.trim() ?? ''
  const status = STATUS_FILTERS.includes(sp.status as (typeof STATUS_FILTERS)[number])
    ? (sp.status as (typeof STATUS_FILTERS)[number])
    : 'all'
  const filtered = q !== '' || status !== 'all'

  const { rows, total } = listProducts(ctx.businessId, {
    search: q || undefined,
    status,
    limit: 200,
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{terminology.itemPlural}</h1>
          <p className="text-muted-foreground text-sm">
            {total.toLocaleString('en-IN')} in your {terminology.catalogSingular.toLowerCase()}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/dashboard/products/new">
            <Plus className="size-4" aria-hidden />
            Add {terminology.itemSingular.toLowerCase()}
          </Link>
        </Button>
      </header>

      {/* Plain GET form: filters live in the URL, so a filtered view is shareable
          and survives a reload without any client state. */}
      <form className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            name="q"
            type="search"
            defaultValue={q}
            aria-label={`Search ${terminology.itemPlural.toLowerCase()}`}
            placeholder="Search by name or SKU"
            className="pl-9"
          />
        </div>
        <Select name="status" defaultValue={status} aria-label="Status" className="w-auto">
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {filtered && (
          <Button asChild variant="ghost">
            <Link href="/dashboard/products">Clear</Link>
          </Button>
        )}
      </form>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Search />}
            title="Nothing matches"
            description="Try a shorter search term, or clear the status filter."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/products">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Boxes />}
            title={`No ${terminology.itemPlural.toLowerCase()} yet`}
            description={`Add your first ${terminology.itemSingular.toLowerCase()}, attach a 3D model, and it goes live on your AR page.`}
            action={
              <Button asChild size="sm">
                <Link href="/dashboard/products/new">
                  Add {terminology.itemSingular.toLowerCase()}
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Category</TH>
                <TH>Price</TH>
                <TH>Status</TH>
                <TH>AR</TH>
                <TH className="text-right">QR</TH>
                <TH className="sr-only">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((p) => {
                const arReady = p.arEnabled && p.model?.status === 'ready'
                const nextStatus = p.status === 'published' ? 'draft' : 'published'

                return (
                  <TR key={p.id}>
                    <TD>
                      <Link
                        href={`/dashboard/products/${p.id}`}
                        className="hover:text-primary font-medium"
                      >
                        {p.name}
                      </Link>
                      {p.shortDescription && (
                        <span className="text-muted-foreground block max-w-56 truncate text-xs">
                          {p.shortDescription}
                        </span>
                      )}
                    </TD>
                    <TD className="text-muted-foreground text-sm whitespace-nowrap">
                      {p.categoryName ?? '—'}
                    </TD>
                    <TD className="tabular-nums whitespace-nowrap">
                      {p.priceMinor === null
                        ? '—'
                        : formatMoney({ amount: p.priceMinor, currency: p.currency })}
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[p.status]} className="capitalize">
                        {p.status}
                      </Badge>
                    </TD>
                    <TD>
                      {arReady ? (
                        <Badge variant="success">Ready</Badge>
                      ) : p.model ? (
                        <Badge variant="warning">
                          {p.arEnabled ? 'Processing' : 'AR off'}
                        </Badge>
                      ) : (
                        <Badge variant="muted">No model</Badge>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{p.qrCount}</TD>
                    <TD className="text-right">
                      <form action={setProductStatusAction.bind(null, p.id, nextStatus)}>
                        <Button type="submit" variant="ghost" size="sm">
                          {p.status === 'published' ? (
                            <>
                              <EyeOff className="size-3.5" aria-hidden />
                              Unpublish
                            </>
                          ) : (
                            <>
                              <Eye className="size-3.5" aria-hidden />
                              Publish
                            </>
                          )}
                        </Button>
                      </form>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
