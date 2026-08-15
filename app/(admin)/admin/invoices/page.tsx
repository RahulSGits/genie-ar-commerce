import Link from 'next/link'
import { ChevronRight, FileText } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import {
  getBillingSummary, listInvoices, markOverdueInvoices,
} from '@/lib/db/repositories/billing'
import { listBusinesses } from '@/lib/db/repositories/businesses'
import { getTaxSettings } from '@/lib/db/repositories/platform'
import { invoiceDueMinor, type InvoiceStatus } from '@/types/domain'
import { formatMoney } from '@/utils/money'
import { formatDate } from '@/lib/utils'
import {
  Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState,
  Stat, TBody, TD, TH, THead, TR, Table,
} from '@/components/ui'
import type { BadgeProps } from '@/components/ui'
import InvoiceEditor from '@/components/admin/InvoiceEditor'

export const metadata = { title: 'Invoices' }
export const dynamic = 'force-dynamic'

const FILTERS = ['all', 'draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'] as const
type Filter = (typeof FILTERS)[number]

const STATUS_VARIANT: Record<InvoiceStatus, BadgeProps['variant']> = {
  draft: 'muted',
  sent: 'default',
  partial: 'warning',
  paid: 'success',
  overdue: 'destructive',
  cancelled: 'outline',
}

export default async function AdminInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireSuperAdmin()

  // Lazy sweep: with no cron worker, statuses are brought up to date on read.
  markOverdueInvoices()

  const requested = (await searchParams).status
  const filter: Filter = FILTERS.includes(requested as Filter) ? (requested as Filter) : 'all'

  const invoices = listInvoices({ status: filter, limit: 200 })
  const summary = getBillingSummary()
  const tax = getTaxSettings()

  // The editor only needs a name to put in a dropdown. A full business row
  // carries internal notes, which must never reach a browser.
  const businesses = listBusinesses({ limit: 200 }).rows.map((b) => ({ id: b.id, name: b.name }))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="text-muted-foreground text-sm">
          Raise invoices and record payments by hand — no gateway involved.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Billed"
          value={formatMoney({ amount: summary.totalBilledMinor, currency: 'INR' })}
          hint={`${summary.invoiceCount} invoices`}
        />
        <Stat
          label="Collected"
          value={formatMoney({ amount: summary.totalPaidMinor, currency: 'INR' })}
        />
        <Stat
          label="Outstanding"
          value={formatMoney({ amount: summary.outstandingMinor, currency: 'INR' })}
        />
        <Stat
          label="Overdue"
          value={formatMoney({ amount: summary.overdueMinor, currency: 'INR' })}
          hint="Past the due date"
        />
      </div>

      <div className="scroll-x -mx-1 flex gap-2 px-1 pb-1">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'all' ? '/admin/invoices' : `/admin/invoices?status=${f}`}
            aria-current={filter === f ? 'page' : undefined}
            className={
              filter === f
                ? 'bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium capitalize'
                : 'text-muted-foreground hover:bg-accent rounded-lg border px-3 py-1.5 text-xs font-medium capitalize'
            }
          >
            {f}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="pt-5">
          {invoices.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title={filter === 'all' ? 'No invoices yet' : `No ${filter} invoices`}
              description={
                filter === 'all'
                  ? 'Raise the first one below — pick a business, add the lines, set a due date.'
                  : 'Nothing sits in this state right now.'
              }
              className="border-0"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Number</TH>
                  <TH>Business</TH>
                  <TH>Issued</TH>
                  <TH>Due</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Paid</TH>
                  <TH className="text-right">Outstanding</TH>
                  <TH>Status</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {invoices.map((invoice) => (
                  <TR key={invoice.id}>
                    <TD className="font-medium">
                      <Link href={`/admin/invoices/${invoice.id}`} className="hover:underline">
                        {invoice.number}
                      </Link>
                    </TD>
                    <TD className="max-w-48 truncate">{invoice.businessName ?? '—'}</TD>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDate(invoice.issueDate)}
                    </TD>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDate(invoice.dueDate)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney({ amount: invoice.totalMinor, currency: invoice.currency })}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney({ amount: invoice.paidMinor, currency: invoice.currency })}
                    </TD>
                    <TD className="text-right font-medium tabular-nums">
                      {formatMoney({
                        amount: invoiceDueMinor(invoice),
                        currency: invoice.currency,
                      })}
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[invoice.status]} className="capitalize">
                        {invoice.status}
                      </Badge>
                    </TD>
                    <TD>
                      <Link
                        href={`/admin/invoices/${invoice.id}`}
                        aria-label={`Open ${invoice.number}`}
                        className="text-muted-foreground hover:text-foreground inline-flex"
                      >
                        <ChevronRight className="size-4" aria-hidden />
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New invoice</CardTitle>
          <CardDescription>
            Created as sent. The total is computed from the lines — you never type it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {businesses.length === 0 ? (
            <EmptyState
              title="No businesses to bill"
              description="Add a business before raising an invoice."
              className="border-0"
            />
          ) : (
            <InvoiceEditor
              businesses={businesses}
              defaultTaxName={tax.name}
              defaultTaxPercent={tax.enabled ? tax.percent : 0}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
