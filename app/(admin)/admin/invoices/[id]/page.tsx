import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Receipt } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { getInvoice } from '@/lib/db/repositories/billing'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { getBranding, getTaxSettings } from '@/lib/db/repositories/platform'
import { setInvoiceStatusAction } from '@/lib/actions/admin'
import { invoiceDueMinor, type InvoiceStatus } from '@/types/domain'
import { formatMoney } from '@/utils/money'
import { formatDate, formatDateTime } from '@/lib/utils'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState,
  Separator, TBody, TD, TH, THead, TR, Table,
} from '@/components/ui'
import type { BadgeProps } from '@/components/ui'
import { PrintButton, RecordPaymentForm } from '@/components/admin/InvoiceEditor'

export const dynamic = 'force-dynamic'

const STATUS_VARIANT: Record<InvoiceStatus, BadgeProps['variant']> = {
  draft: 'muted',
  sent: 'default',
  partial: 'warning',
  paid: 'success',
  overdue: 'destructive',
  cancelled: 'outline',
}

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled']

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  razorpay: 'Razorpay',
  other: 'Other',
}

/**
 * Paper rules. The dashboard chrome is navigation, not part of the document an
 * admin posts to a client, and a dark-theme invoice prints as a wall of toner —
 * so the tokens fall back to the light palette for the print media only.
 */
const PRINT_CSS = `
@page { margin: 14mm; }
@media print {
  aside, .no-print { display: none !important; }
  main { padding: 0 !important; }
  div:has(> main) { padding-left: 0 !important; }
  .print-flat { border: 0 !important; box-shadow: none !important; padding: 0 !important; }
  .dark {
    --background: oklch(1 0 0);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.19 0.01 265);
    --foreground: oklch(0.19 0.01 265);
    --muted: oklch(0.965 0.004 275);
    --muted-foreground: oklch(0.42 0.017 275);
    --border: oklch(0.9 0.005 275);
  }
}
`

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const invoice = getInvoice((await params).id)
  return { title: invoice ? `Invoice ${invoice.number}` : 'Invoice' }
}

export default async function AdminInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSuperAdmin()

  const invoice = getInvoice((await params).id)
  if (!invoice) notFound()

  const business = getBusinessById(invoice.businessId)
  const branding = getBranding()
  const tax = getTaxSettings()
  const items = invoice.items ?? []
  const payments = invoice.payments ?? []
  const outstanding = invoiceDueMinor(invoice)
  const money = (amount: number) => formatMoney({ amount, currency: invoice.currency })

  return (
    <div className="space-y-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/invoices">
            <ArrowLeft className="size-4" aria-hidden />
            All invoices
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[invoice.status]} className="capitalize">
            {invoice.status}
          </Badge>
          <PrintButton />
        </div>
      </div>

      <Card className="print-flat">
        <CardContent className="space-y-6 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold">{branding.name}</p>
              {branding.supportEmail && (
                <p className="text-muted-foreground text-sm">{branding.supportEmail}</p>
              )}
              {tax.enabled && tax.taxId && (
                <p className="text-muted-foreground text-sm">
                  {tax.name} ID: {tax.taxId}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Invoice
              </p>
              <p className="text-xl font-semibold tabular-nums">{invoice.number}</p>
              <p className="text-muted-foreground text-sm">
                Issued {formatDate(invoice.issueDate, business?.timezone)}
              </p>
              <p className="text-muted-foreground text-sm">
                Due {formatDate(invoice.dueDate, business?.timezone)}
              </p>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Billed to
              </p>
              <p className="font-medium">{invoice.businessName ?? business?.name ?? '—'}</p>
              {business?.address && (
                <p className="text-muted-foreground text-sm">{business.address}</p>
              )}
              {business?.city && <p className="text-muted-foreground text-sm">{business.city}</p>}
              {business?.email && <p className="text-muted-foreground text-sm">{business.email}</p>}
              {business?.phone && <p className="text-muted-foreground text-sm">{business.phone}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Amount due
              </p>
              <p className="text-2xl font-semibold tabular-nums">{money(outstanding)}</p>
              {business && (
                <Link
                  href={`/admin/businesses/${business.id}`}
                  className="text-primary no-print text-sm hover:underline"
                >
                  Open business
                </Link>
              )}
            </div>
          </div>

          <Table>
            <THead>
              <TR>
                <TH>Description</TH>
                <TH>Type</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Unit</TH>
                <TH className="text-right">Amount</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((item) => (
                <TR key={item.id}>
                  <TD className="font-medium">{item.description}</TD>
                  <TD className="text-muted-foreground capitalize">
                    {item.kind.replace('_', ' ')}
                  </TD>
                  <TD className="text-right tabular-nums">{item.quantity}</TD>
                  <TD className="text-right tabular-nums">{money(item.unitMinor)}</TD>
                  <TD className="text-right tabular-nums">{money(item.amountMinor)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <div className="flex justify-end">
            <dl className="w-full space-y-1.5 text-sm sm:w-72">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{money(invoice.subtotalMinor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular-nums">−{money(invoice.discountMinor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  {invoice.taxName ?? 'Tax'}
                  {invoice.taxPercent ? ` (${invoice.taxPercent}%)` : ''}
                </dt>
                <dd className="tabular-nums">{money(invoice.taxMinor)}</dd>
              </div>
              <Separator className="my-1" />
              <div className="flex justify-between font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(invoice.totalMinor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="tabular-nums">{money(invoice.paidMinor)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Due</dt>
                <dd className="tabular-nums">{money(outstanding)}</dd>
              </div>
            </dl>
          </div>

          {invoice.notes && (
            <div className="text-sm">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Notes
              </p>
              <p className="whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="print-flat">
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <EmptyState
              icon={<Receipt />}
              title="Nothing received yet"
              description="Record a payment below as soon as the transfer lands."
              className="border-0"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Method</TH>
                  <TH>Reference</TH>
                  <TH>Notes</TH>
                </TR>
              </THead>
              <TBody>
                {payments.map((payment) => (
                  <TR key={payment.id}>
                    <TD className="whitespace-nowrap">
                      {formatDateTime(payment.paidAt, business?.timezone)}
                    </TD>
                    <TD className="text-right font-medium tabular-nums">
                      {formatMoney({ amount: payment.amountMinor, currency: payment.currency })}
                    </TD>
                    <TD>{METHOD_LABELS[payment.method] ?? payment.method}</TD>
                    <TD className="text-muted-foreground">{payment.reference ?? '—'}</TD>
                    <TD className="text-muted-foreground max-w-56 truncate">
                      {payment.notes ?? '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="no-print grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record payment</CardTitle>
          </CardHeader>
          <CardContent>
            <RecordPaymentForm
              invoiceId={invoice.id}
              businessId={invoice.businessId}
              outstandingMinor={outstanding}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Paid and partial are derived from recorded payments. Set a status by hand only to
              correct one — cancelling, or pulling an invoice back to draft.
            </p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.filter((s) => s !== invoice.status).map((status) => (
                <form key={status} action={setInvoiceStatusAction.bind(null, invoice.id, status)}>
                  <Button type="submit" size="sm" variant="outline" className="capitalize">
                    Mark {status}
                  </Button>
                </form>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
