import 'server-only'

import {
  getDb, now, uuid, str, strOrNull, num, numOrNull, param, transaction,
  type Row, type SqlParam,
} from '@/lib/db'
import type { CurrencyCode } from '@/utils/money'
import type {
  Coupon, Invoice, InvoiceItem, InvoiceStatus, InvoiceItemKind, Payment, PaymentMethod,
} from '@/types/domain'

/**
 * Billing.
 *
 * Manual-first by design: invoices are raised and payments recorded by the
 * super admin. No payment gateway is required for any of this to work, which is
 * what keeps the MVP free to run.
 *
 * The invariant this module protects: `invoices.paid_minor` always equals the
 * sum of that invoice's payments. It is denormalised for fast dashboard reads,
 * so every write that could change it happens inside a transaction that
 * recomputes it from the payments table rather than incrementing a counter.
 */

function mapInvoice(row: Row): Invoice {
  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    subscriptionId: strOrNull(row, 'subscription_id'),
    number: str(row, 'number'),
    status: (str(row, 'status') || 'draft') as InvoiceStatus,
    currency: (str(row, 'currency') || 'INR') as CurrencyCode,
    subtotalMinor: num(row, 'subtotal_minor'),
    discountMinor: num(row, 'discount_minor'),
    taxMinor: num(row, 'tax_minor'),
    totalMinor: num(row, 'total_minor'),
    paidMinor: num(row, 'paid_minor'),
    taxName: strOrNull(row, 'tax_name'),
    taxPercent: num(row, 'tax_percent'),
    issueDate: str(row, 'issue_date'),
    dueDate: str(row, 'due_date'),
    paidAt: strOrNull(row, 'paid_at'),
    notes: strOrNull(row, 'notes'),
    createdAt: str(row, 'created_at'),
    businessName: strOrNull(row, 'business_name') ?? undefined,
  }
}

function mapItem(row: Row): InvoiceItem {
  return {
    id: str(row, 'id'),
    invoiceId: str(row, 'invoice_id'),
    description: str(row, 'description'),
    quantity: num(row, 'quantity', 1),
    unitMinor: num(row, 'unit_minor'),
    amountMinor: num(row, 'amount_minor'),
    kind: (str(row, 'kind') || 'custom') as InvoiceItemKind,
    sortOrder: num(row, 'sort_order'),
  }
}

function mapPayment(row: Row): Payment {
  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    invoiceId: strOrNull(row, 'invoice_id'),
    amountMinor: num(row, 'amount_minor'),
    currency: (str(row, 'currency') || 'INR') as CurrencyCode,
    method: (str(row, 'method') || 'cash') as PaymentMethod,
    reference: strOrNull(row, 'reference'),
    proofUrl: strOrNull(row, 'proof_url'),
    notes: strOrNull(row, 'notes'),
    paidAt: str(row, 'paid_at'),
    recordedBy: strOrNull(row, 'recorded_by'),
    createdAt: str(row, 'created_at'),
  }
}

/* ── reads ──────────────────────────────────────────────────────────────── */

export function listInvoices(opts: {
  businessId?: string
  status?: InvoiceStatus | 'all'
  limit?: number
} = {}): Invoice[] {
  const where: string[] = ['i.deleted_at IS NULL']
  const params: SqlParam[] = []

  if (opts.businessId) {
    where.push('i.business_id = ?')
    params.push(param(opts.businessId))
  }
  if (opts.status && opts.status !== 'all') {
    where.push('i.status = ?')
    params.push(param(opts.status))
  }

  const rows = getDb()
    .prepare(
      `SELECT i.*, b.name AS business_name
         FROM invoices i
         JOIN businesses b ON b.id = i.business_id
        WHERE ${where.join(' AND ')}
        ORDER BY i.issue_date DESC
        LIMIT ?`,
    )
    .all(...params, opts.limit ?? 100) as Row[]

  return rows.map(mapInvoice)
}

/** Full invoice with its lines and payments, tenant-scoped when businessId given. */
export function getInvoice(id: string, businessId?: string): Invoice | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT i.*, b.name AS business_name
         FROM invoices i
         JOIN businesses b ON b.id = i.business_id
        WHERE i.id = ? AND i.deleted_at IS NULL
        ${businessId ? 'AND i.business_id = ?' : ''}`,
    )
    .get(...(businessId ? [id, businessId] : [id])) as Row | undefined

  if (!row) return null

  const invoice = mapInvoice(row)
  invoice.items = (
    db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order`).all(id) as Row[]
  ).map(mapItem)
  invoice.payments = (
    db.prepare(`SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC`).all(id) as Row[]
  ).map(mapPayment)

  return invoice
}

/** Count of invoices a business still owes on — drives the sidebar badge. */
export function getOutstandingCount(businessId: string): number {
  return num(
    getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM invoices
          WHERE business_id = ? AND deleted_at IS NULL
            AND status IN ('sent','partial','overdue')`,
      )
      .get(businessId) as Row,
    'c',
  )
}

export type BillingSummary = {
  totalBilledMinor: number
  totalPaidMinor: number
  outstandingMinor: number
  overdueMinor: number
  invoiceCount: number
}

export function getBillingSummary(businessId?: string): BillingSummary {
  const db = getDb()
  const scope = businessId ? 'AND business_id = ?' : ''
  const args: SqlParam[] = businessId ? [businessId] : []
  const today = now().slice(0, 10)

  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(total_minor), 0) AS billed,
         COALESCE(SUM(paid_minor), 0) AS paid,
         COALESCE(SUM(CASE WHEN status IN ('sent','partial','overdue')
                           THEN total_minor - paid_minor ELSE 0 END), 0) AS outstanding,
         COALESCE(SUM(CASE WHEN status IN ('sent','partial','overdue') AND date(due_date) < date(?)
                           THEN total_minor - paid_minor ELSE 0 END), 0) AS overdue,
         COUNT(*) AS c
       FROM invoices
      WHERE deleted_at IS NULL AND status != 'cancelled' ${scope}`,
    )
    .get(today, ...args) as Row

  return {
    totalBilledMinor: num(row, 'billed'),
    totalPaidMinor: num(row, 'paid'),
    outstandingMinor: num(row, 'outstanding'),
    overdueMinor: num(row, 'overdue'),
    invoiceCount: num(row, 'c'),
  }
}

export function listCoupons(): Coupon[] {
  const rows = getDb()
    .prepare(`SELECT * FROM coupons ORDER BY created_at DESC`)
    .all() as Row[]

  return rows.map((r) => ({
    id: str(r, 'id'),
    code: str(r, 'code'),
    description: strOrNull(r, 'description'),
    discountType: (str(r, 'discount_type') || 'percentage') as 'percentage' | 'fixed',
    discountValue: num(r, 'discount_value'),
    duration: (str(r, 'duration') || 'once') as 'once' | 'recurring',
    applicablePlans: null,
    startsAt: strOrNull(r, 'starts_at'),
    expiresAt: strOrNull(r, 'expires_at'),
    maxRedemptions: numOrNull(r, 'max_redemptions'),
    perBusinessLimit: num(r, 'per_business_limit', 1),
    redemptionCount: num(r, 'redemption_count'),
    isActive: num(r, 'is_active') === 1,
  }))
}

/** Recognised revenue by month, for the admin revenue chart. */
export function getMonthlyRevenue(months = 12): Array<{ month: string; amountMinor: number }> {
  const rows = getDb()
    .prepare(
      `SELECT substr(paid_at, 1, 7) AS month, COALESCE(SUM(amount_minor), 0) AS amount
         FROM payments
        GROUP BY month
        ORDER BY month DESC
        LIMIT ?`,
    )
    .all(months) as Row[]

  return rows
    .map((r) => ({ month: str(r, 'month'), amountMinor: num(r, 'amount') }))
    .reverse()
}

/* ── writes ─────────────────────────────────────────────────────────────── */

export type CreateInvoiceInput = {
  businessId: string
  subscriptionId?: string | null
  items: Array<{ description: string; quantity?: number; unitMinor: number; kind?: InvoiceItemKind }>
  discountMinor?: number
  taxName?: string | null
  taxPercent?: number
  issueDate?: string
  dueDate: string
  notes?: string | null
  status?: InvoiceStatus
  currency?: CurrencyCode
}

function nextInvoiceNumber(prefix: string): string {
  const row = getDb()
    .prepare(`SELECT number FROM invoices WHERE number LIKE ? ORDER BY number DESC LIMIT 1`)
    .get(`${prefix}%`) as Row | undefined

  const last = row ? Number(str(row, 'number').slice(prefix.length)) : 0
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`
}

/**
 * Creates an invoice and its lines atomically, computing every total from the
 * line items — the caller never supplies a total, so an invoice whose parts
 * don't sum to its total is not representable.
 */
export function createInvoice(input: CreateInvoiceInput): string {
  return transaction(() => {
    const db = getDb()
    const id = uuid()
    const prefix = `INV-${new Date().getUTCFullYear()}-`
    const number = nextInvoiceNumber(prefix)

    const lines = input.items.map((item, index) => {
      const qty = item.quantity ?? 1
      return {
        id: uuid(),
        description: item.description,
        quantity: qty,
        unitMinor: item.unitMinor,
        amountMinor: item.unitMinor * qty,
        kind: item.kind ?? ('custom' as InvoiceItemKind),
        sortOrder: index,
      }
    })

    const subtotal = lines.reduce((s, l) => s + l.amountMinor, 0)
    const discount = Math.min(input.discountMinor ?? 0, subtotal)
    const taxPercent = input.taxPercent ?? 0
    // Rounded once on the taxable base, never per line — that is what keeps
    // subtotal - discount + tax === total exactly.
    const tax = Math.round(((subtotal - discount) * taxPercent) / 100)
    const total = subtotal - discount + tax

    const issueDate = input.issueDate ?? now()

    db.prepare(
      `INSERT INTO invoices
         (id, business_id, subscription_id, number, status, currency, subtotal_minor,
          discount_minor, tax_minor, total_minor, paid_minor, tax_name, tax_percent,
          issue_date, due_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, input.businessId, input.subscriptionId ?? null, number,
      input.status ?? 'draft', input.currency ?? 'INR',
      subtotal, discount, tax, total,
      input.taxName ?? null, taxPercent,
      issueDate, input.dueDate, input.notes ?? null, now(), now(),
    )

    const stmt = db.prepare(
      `INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_minor, amount_minor, kind, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const l of lines) {
      stmt.run(l.id, id, l.description, l.quantity, l.unitMinor, l.amountMinor, l.kind, l.sortOrder)
    }

    return id
  })
}

/**
 * Records a payment and re-derives the invoice's paid total and status inside
 * one transaction. Partial payments accumulate correctly because the total is
 * recomputed from the payments table rather than incremented.
 */
export function recordPayment(input: {
  businessId: string
  invoiceId: string
  amountMinor: number
  method: PaymentMethod
  reference?: string | null
  notes?: string | null
  paidAt?: string
  recordedBy: string
}): void {
  transaction(() => {
    const db = getDb()

    db.prepare(
      `INSERT INTO payments
         (id, business_id, invoice_id, amount_minor, currency, method, reference, notes, paid_at, recorded_by, created_at)
       VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?)`,
    ).run(
      uuid(), input.businessId, input.invoiceId, input.amountMinor,
      input.method, input.reference ?? null, input.notes ?? null,
      input.paidAt ?? now(), input.recordedBy, now(),
    )

    const totals = db
      .prepare(
        `SELECT i.total_minor AS total,
                COALESCE((SELECT SUM(amount_minor) FROM payments WHERE invoice_id = i.id), 0) AS paid
           FROM invoices i WHERE i.id = ?`,
      )
      .get(input.invoiceId) as Row

    const total = num(totals, 'total')
    const paid = num(totals, 'paid')
    const status: InvoiceStatus = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'sent'

    db.prepare(
      `UPDATE invoices SET paid_minor = ?, status = ?, paid_at = ?, updated_at = ? WHERE id = ?`,
    ).run(paid, status, status === 'paid' ? now() : null, now(), input.invoiceId)
  })
}

export function setInvoiceStatus(id: string, status: InvoiceStatus): void {
  getDb()
    .prepare(`UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, now(), id)
}

/**
 * Flags sent/partial invoices whose due date has passed.
 *
 * Evaluated lazily on read rather than by a scheduled job — with no background
 * worker available on a free deployment, an on-demand sweep is what keeps
 * status honest without inventing infrastructure.
 */
export function markOverdueInvoices(): number {
  const result = getDb()
    .prepare(
      `UPDATE invoices
          SET status = 'overdue', updated_at = ?
        WHERE deleted_at IS NULL
          AND status IN ('sent','partial')
          AND date(due_date) < date(?)`,
    )
    .run(now(), now().slice(0, 10))
  return result.changes as number
}
