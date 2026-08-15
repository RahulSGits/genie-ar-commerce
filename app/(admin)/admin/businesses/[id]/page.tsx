import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Boxes, ExternalLink, FileText, IndianRupee, QrCode, ScanLine } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { getBusinessById, getSubscription, listMembers, listPlans } from '@/lib/db/repositories/businesses'
import { getBusinessStats } from '@/lib/db/repositories/analytics'
import { listProducts } from '@/lib/db/repositories/catalog'
import { listQrCodes } from '@/lib/db/repositories/qr'
import { getBillingSummary, listInvoices } from '@/lib/db/repositories/billing'
import { BUSINESS_CATEGORY_LABELS } from '@/config/terminology'
import { invoiceDueMinor, type Business, type Invoice } from '@/types/domain'
import { formatMoney } from '@/utils/money'
import { formatDate } from '@/lib/utils'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Stat,
  TBody, TD, TH, THead, TR, Table,
} from '@/components/ui'
import BusinessAdminPanel from '@/components/admin/BusinessAdminPanel'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const business = getBusinessById(id)
  return { title: business ? business.name : 'Business' }
}

const statusVariant = (status: Business['status']) =>
  status === 'active' ? 'success' : status === 'suspended' ? 'destructive' : 'muted'

const invoiceVariant = (status: Invoice['status']) => {
  if (status === 'paid') return 'success'
  if (status === 'overdue') return 'destructive'
  if (status === 'partial' || status === 'sent') return 'warning'
  return 'muted'
}

export default async function AdminBusinessDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSuperAdmin()
  const { id } = await params

  const business = getBusinessById(id)
  if (!business) notFound()

  const subscription = getSubscription(id)
  // Archived plans are included so a legacy plan still renders its own name.
  const plans = listPlans({ includeArchived: true })
  // A ten-year window is the account's whole history, not the operating view.
  const stats = getBusinessStats(id, 3650)
  const { total: productCount } = listProducts(id, { limit: 1 })
  const qrCodes = listQrCodes(id)
  const invoices = listInvoices({ businessId: id })
  const billing = getBillingSummary(id)
  const members = listMembers(id)

  const plan = plans.find((p) => p.id === subscription?.planId) ?? null
  const price = subscription?.negotiatedPriceMinor ?? plan?.priceMinor ?? 0

  const profile: Array<[string, string]> = [
    ['Category', BUSINESS_CATEGORY_LABELS[business.category]],
    ['Email', business.email ?? '—'],
    ['Phone', business.phone ?? '—'],
    ['City', business.city ?? '—'],
    ['Timezone', business.timezone],
    ['Created', formatDate(business.createdAt, business.timezone)],
  ]

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/businesses">
            <ArrowLeft className="size-4" aria-hidden />
            Businesses
          </Link>
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{business.name}</h1>
              <Badge variant={statusVariant(business.status)} className="capitalize">
                {business.status}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {plan?.name ?? 'No plan'} ·{' '}
              {formatMoney({ amount: price, currency: business.currency })}
              {subscription?.negotiatedPriceMinor != null && ' (negotiated)'}
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/ar/${business.slug}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" aria-hidden />
              Public catalog
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Products" value={productCount.toLocaleString('en-IN')} icon={<Boxes />}
          hint={`${stats.arProducts.toLocaleString('en-IN')} AR-ready`} />
        <Stat label="QR codes" value={qrCodes.length.toLocaleString('en-IN')} icon={<QrCode />} />
        <Stat label="Scans" value={stats.totalScans.toLocaleString('en-IN')} icon={<ScanLine />}
          hint={`${stats.arSessions.toLocaleString('en-IN')} AR sessions`} />
        <Stat
          label="Outstanding"
          value={formatMoney({ amount: billing.outstandingMinor, currency: business.currency })}
          icon={<IndianRupee />}
          hint={
            billing.overdueMinor > 0
              ? `${formatMoney({ amount: billing.overdueMinor, currency: business.currency })} overdue`
              : 'Nothing overdue'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              {profile.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="truncate text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team</CardTitle>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">
                Nobody can sign in to this account yet.
              </p>
            ) : (
              <ul className="divide-y">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.fullName}</p>
                      <p className="text-muted-foreground truncate text-xs">{m.email}</p>
                    </div>
                    <Badge variant="secondary" className="capitalize">
                      {m.role}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <BusinessAdminPanel
        businessId={business.id}
        businessName={business.name}
        businessStatus={business.status}
        subscription={subscription}
        plans={plans}
        internalNotes={business.internalNotes}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title="No invoices yet"
              description="This client has never been billed."
              action={
                <Button asChild size="sm">
                  <Link href="/admin/invoices">Create an invoice</Link>
                </Button>
              }
              className="border-0"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Status</TH>
                  <TH>Issued</TH>
                  <TH>Due</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Balance</TH>
                </TR>
              </THead>
              <TBody>
                {invoices.map((invoice) => (
                  <TR key={invoice.id}>
                    <TD>
                      <Link
                        href={`/admin/invoices/${invoice.id}`}
                        className="font-medium hover:underline"
                      >
                        {invoice.number}
                      </Link>
                    </TD>
                    <TD>
                      <Badge variant={invoiceVariant(invoice.status)} className="capitalize">
                        {invoice.status}
                      </Badge>
                    </TD>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDate(invoice.issueDate, business.timezone)}
                    </TD>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDate(invoice.dueDate, business.timezone)}
                    </TD>
                    <TD className="text-right whitespace-nowrap tabular-nums">
                      {formatMoney({ amount: invoice.totalMinor, currency: invoice.currency })}
                    </TD>
                    <TD className="text-right whitespace-nowrap tabular-nums">
                      {formatMoney({
                        amount: invoiceDueMinor(invoice),
                        currency: invoice.currency,
                      })}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
