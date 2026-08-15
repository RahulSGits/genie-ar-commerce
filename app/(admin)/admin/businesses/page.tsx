import Link from 'next/link'
import { Building2, Plus, Search } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { listBusinesses } from '@/lib/db/repositories/businesses'
import { BUSINESS_CATEGORY_LABELS } from '@/config/terminology'
import { formatDate } from '@/lib/utils'
import {
  Badge, Button, Card, CardContent, EmptyState, Input, Select,
  TBody, TD, TH, THead, TR, Table,
} from '@/components/ui'
import type { Business } from '@/types/domain'

export const metadata = { title: 'Businesses' }
export const dynamic = 'force-dynamic'

const BUSINESS_STATUSES: Array<Business['status']> = ['active', 'suspended', 'archived']

const statusVariant = (status: Business['status']) =>
  status === 'active' ? 'success' : status === 'suspended' ? 'destructive' : 'muted'

const subStatusVariant = (status: string | null) => {
  if (status === 'active') return 'success'
  if (status === 'trialing') return 'default'
  if (status === 'past_due' || status === 'grace') return 'warning'
  if (status === 'suspended' || status === 'cancelled') return 'destructive'
  return 'muted'
}

export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  await requireSuperAdmin()
  const params = await searchParams

  const q = (params.q ?? '').trim()
  // Anything unrecognised falls back to 'all' rather than filtering to nothing.
  const status = BUSINESS_STATUSES.includes(params.status as Business['status'])
    ? (params.status as Business['status'])
    : 'all'

  const { rows, total } = listBusinesses({ search: q || undefined, status, limit: 200 })
  const filtered = q !== '' || status !== 'all'

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Businesses</h1>
          <p className="text-muted-foreground text-sm">
            {total.toLocaleString('en-IN')} {total === 1 ? 'business' : 'businesses'}
            {filtered && ' matching'}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/businesses/new">
            <Plus className="size-4" aria-hidden />
            Add business
          </Link>
        </Button>
      </header>

      <Card>
        <CardContent className="pt-5">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <label htmlFor="q" className="sr-only">
                Search businesses
              </label>
              <Input
                id="q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Name, email, phone or slug"
              />
            </div>
            <div className="w-40">
              <label htmlFor="status" className="sr-only">
                Status
              </label>
              <Select id="status" name="status" defaultValue={status}>
                <option value="all">All statuses</option>
                {BUSINESS_STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s[0]?.toUpperCase()}
                    {s.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline">
              <Search className="size-4" aria-hidden />
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={filtered ? 'No businesses match' : 'No businesses yet'}
          description={
            filtered
              ? 'Try a broader search, or clear the status filter.'
              : 'Onboard your first client and their AR catalog goes live the same day.'
          }
          action={
            filtered ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/businesses">Clear filters</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href="/admin/businesses/new">Add business</Link>
              </Button>
            )
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Business</TH>
                <TH>Category</TH>
                <TH>Plan</TH>
                <TH>Subscription</TH>
                <TH>Status</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <Link
                      href={`/admin/businesses/${b.id}`}
                      className="font-medium hover:underline"
                    >
                      {b.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">/{b.slug}</p>
                  </TD>
                  <TD className="text-muted-foreground whitespace-nowrap">
                    {BUSINESS_CATEGORY_LABELS[b.category]}
                  </TD>
                  <TD className="text-muted-foreground whitespace-nowrap">
                    {b.planName ?? 'No plan'}
                  </TD>
                  <TD>
                    <Badge variant={subStatusVariant(b.subStatus)} className="capitalize">
                      {b.subStatus ? b.subStatus.replace('_', ' ') : 'none'}
                    </Badge>
                  </TD>
                  <TD>
                    <Badge variant={statusVariant(b.status)} className="capitalize">
                      {b.status}
                    </Badge>
                  </TD>
                  <TD className="text-muted-foreground whitespace-nowrap">
                    {formatDate(b.createdAt)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
