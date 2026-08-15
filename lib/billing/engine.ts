import 'server-only'

import { getDb, now, uuid, transaction, str, strOrNull, num, type Row } from '@/lib/db'
import { createInvoice } from '@/lib/db/repositories/billing'
import {
  getBillingSettings, getTaxSettings, createNotification, recordAudit,
} from '@/lib/db/repositories/platform'
import { formatMoney } from '@/utils/money'
import type { CurrencyCode } from '@/utils/money'
import type { SubscriptionStatus } from '@/lib/billing/entitlements'

/**
 * The billing automation engine.
 *
 * Everything that used to require an admin to remember something now happens
 * here: renewal invoices are raised, invoices go overdue, subscriptions move
 * through their lifecycle, and reminders are sent on schedule.
 *
 * ── DESIGN CONSTRAINTS ──────────────────────────────────────────────────────
 *
 * IDEMPOTENT. Every operation is safe to run any number of times. This is not a
 * nicety — without a paid job runner the tick is triggered opportunistically
 * (on admin page load, by an HTTP cron, by a CLI), so double execution is the
 * normal case rather than the exceptional one. Idempotency comes from state
 * transitions and unique constraints, never from "have I run today?" bookkeeping,
 * which itself would need to be correct.
 *
 * NO CLOCK GUESSING. `now` is injected so the whole engine is testable against
 * fixed dates rather than whatever today happens to be.
 *
 * NEVER SILENTLY DESTRUCTIVE. Suspension — the one action that takes a paying
 * venue's live QR codes offline — is gated behind an explicit `autoSuspend`
 * setting that defaults to OFF. Everything else only ever adds records.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type TickReport = {
  ranAt: string
  invoicesRaised: number
  invoicesMarkedOverdue: number
  subscriptionsAdvanced: number
  remindersSent: number
  businessesSuspended: number
  /** Human-readable trail, surfaced in the admin UI. */
  notes: string[]
}

const DAY_MS = 86_400_000

/** Whole days between two instants, floored — partial days do not count. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  // Compare at UTC midnight so a due date is "1 day overdue" for the whole of
  // the following day rather than flipping at the exact timestamp it was issued.
  const midnight = (ms: number) => Math.floor(ms / DAY_MS)
  return midnight(b) - midnight(a)
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(iso)
  const day = d.getUTCDate()
  d.setUTCMonth(d.getUTCMonth() + months)
  // A period starting on the 31st must not skid into the following month when
  // the next one is shorter — clamp to that month's last day instead.
  if (d.getUTCDate() < day) d.setUTCDate(0)
  return d.toISOString()
}

export function addYears(iso: string, years: number): string {
  const d = new Date(iso)
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString()
}

/**
 * Decides what a subscription's status should be, from scratch, given the facts.
 *
 * Pure and total: no database, no clock, no partial application of previous
 * runs. That is deliberate — a state machine that increments step by step gets
 * stuck when a tick is missed, whereas recomputing from the oldest unpaid
 * invoice is self-healing. Miss a week of ticks and the next one still lands on
 * the correct answer.
 */
export function resolveSubscriptionStatus(input: {
  current: SubscriptionStatus
  at: string
  trialEndsAt: string | null
  /** Due date of the oldest unpaid invoice, or null when nothing is outstanding. */
  oldestUnpaidDueDate: string | null
  graceDays: number
  autoSuspend: boolean
}): SubscriptionStatus {
  const { current, at, trialEndsAt, oldestUnpaidDueDate, graceDays, autoSuspend } = input

  // Cancelled is terminal — only an admin brings an account back from it.
  if (current === 'cancelled') return 'cancelled'

  if (current === 'trialing') {
    // An unpaid invoice during a trial is not yet a delinquency; the trial ends
    // on its date and nothing else.
    return trialEndsAt && trialEndsAt <= at ? 'active' : 'trialing'
  }

  // Nothing outstanding is always recoverable, including out of suspension.
  if (!oldestUnpaidDueDate) return 'active'

  const overdueDays = daysBetween(oldestUnpaidDueDate, at)
  if (overdueDays <= 0) return 'active'
  if (overdueDays <= graceDays) return 'past_due'

  // Past the grace window. Suspension is opt-in; otherwise the account sits in
  // `grace` indefinitely and stays usable until a human decides otherwise.
  return autoSuspend ? 'suspended' : 'grace'
}

/* ── the tick ───────────────────────────────────────────────────────────── */

export function runBillingTick(at: string = now()): TickReport {
  const report: TickReport = {
    ranAt: at,
    invoicesRaised: 0,
    invoicesMarkedOverdue: 0,
    subscriptionsAdvanced: 0,
    remindersSent: 0,
    businessesSuspended: 0,
    notes: [],
  }

  // Order matters: renewals first so a freshly-raised invoice is considered by
  // the overdue and reminder passes in the same tick.
  raiseRenewalInvoices(at, report)
  markOverdue(at, report)
  advanceSubscriptions(at, report)
  dispatchReminders(at, report)

  return report
}

/* ── 1. renewal invoices ────────────────────────────────────────────────── */

/**
 * Raises an invoice for any subscription whose billing period has ended, then
 * rolls the period forward.
 *
 * Idempotency comes from the roll-forward itself: once the period end is in the
 * future, the subscription no longer matches. There is no "already invoiced"
 * flag to get out of sync, and the write is transactional so a crash between
 * the two cannot double-bill.
 */
function raiseRenewalInvoices(at: string, report: TickReport): void {
  const db = getDb()
  const tax = getTaxSettings()

  const due = db
    .prepare(
      `SELECT s.id, s.business_id, s.plan_id, s.billing_interval, s.current_period_end,
              s.negotiated_price_minor, s.status,
              p.name AS plan_name, p.price_minor, p.currency,
              b.name AS business_name, b.status AS business_status
         FROM subscriptions s
         JOIN subscription_plans p ON p.id = s.plan_id
         JOIN businesses b ON b.id = s.business_id
        WHERE s.current_period_end <= ?
          AND s.status IN ('active','past_due','grace')
          AND b.deleted_at IS NULL`,
    )
    .all(at) as Row[]

  for (const row of due) {
    const subscriptionId = str(row, 'id')
    const businessId = str(row, 'business_id')
    const interval = str(row, 'billing_interval') || 'monthly'
    const periodEnd = str(row, 'current_period_end')

    // The negotiated price wins, and is read per subscription — the shared plan
    // is never consulted for what this business actually pays.
    const price = row.negotiated_price_minor === null
      ? num(row, 'price_minor')
      : num(row, 'negotiated_price_minor')

    // A zero-price plan (internal, comped) should advance its period without
    // generating a ₹0 invoice nobody will ever pay.
    const nextEnd = interval === 'yearly' ? addYears(periodEnd, 1) : addMonths(periodEnd, 1)

    transaction(() => {
      if (price > 0) {
        const dueDate = new Date(Date.parse(periodEnd) + 7 * DAY_MS).toISOString()
        createInvoice({
          businessId,
          subscriptionId,
          items: [
            {
              description: `${str(row, 'plan_name')} — ${interval === 'yearly' ? 'annual' : 'monthly'} subscription`,
              unitMinor: price,
              kind: 'subscription',
            },
          ],
          dueDate,
          issueDate: periodEnd,
          status: 'sent',
          currency: (str(row, 'currency') || 'INR') as CurrencyCode,
          // Tax MUST be passed explicitly. createInvoice defaults taxPercent to
          // 0, so omitting it would raise every automated renewal with no GST —
          // silently under-billing on every invoice the system generates.
          taxName: tax.enabled ? tax.name : null,
          taxPercent: tax.enabled ? tax.percent : 0,
        })
        report.invoicesRaised++
      }

      db.prepare(
        `UPDATE subscriptions
            SET current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE id = ?`,
      ).run(periodEnd, nextEnd, at, subscriptionId)
    })

    report.notes.push(
      price > 0
        ? `Raised renewal invoice for ${str(row, 'business_name')} (${formatMoney({ amount: price, currency: (str(row, 'currency') || 'INR') as CurrencyCode })})`
        : `Advanced period for ${str(row, 'business_name')} (no charge)`,
    )
  }
}

/* ── 2. overdue ─────────────────────────────────────────────────────────── */

function markOverdue(at: string, report: TickReport): void {
  const result = getDb()
    .prepare(
      `UPDATE invoices
          SET status = 'overdue', updated_at = ?
        WHERE deleted_at IS NULL
          AND status IN ('sent','partial')
          AND due_date < ?
          AND total_minor > paid_minor`,
    )
    .run(at, at)

  report.invoicesMarkedOverdue = Number(result.changes ?? 0)
}

/* ── 3. subscription lifecycle ──────────────────────────────────────────── */

/**
 * Moves subscriptions through trialing → active → past_due → grace → suspended,
 * and back to active the moment the balance is cleared.
 *
 * The status is derived from the oldest unpaid invoice on every run rather than
 * incremented step by step, so a subscription cannot get stuck in a stale state
 * because one tick was missed.
 */
function advanceSubscriptions(at: string, report: TickReport): void {
  const db = getDb()
  const settings = getBillingSettings()

  const subs = db
    .prepare(
      `SELECT s.id, s.business_id, s.status, s.trial_ends_at, s.grace_days,
              b.name AS business_name, b.status AS business_status,
              (SELECT MIN(i.due_date) FROM invoices i
                WHERE i.business_id = s.business_id
                  AND i.deleted_at IS NULL
                  AND i.status IN ('sent','partial','overdue')
                  AND i.total_minor > i.paid_minor) AS oldest_due
         FROM subscriptions s
         JOIN businesses b ON b.id = s.business_id
        WHERE s.status NOT IN ('cancelled') AND b.deleted_at IS NULL`,
    )
    .all() as Row[]

  for (const row of subs) {
    const id = str(row, 'id')
    const businessId = str(row, 'business_id')
    const current = str(row, 'status') as SubscriptionStatus
    const trialEnds = strOrNull(row, 'trial_ends_at')
    const oldestDue = strOrNull(row, 'oldest_due')
    const graceDays = num(row, 'grace_days', settings.gracePeriodDays)

    const next = resolveSubscriptionStatus({
      current,
      at,
      trialEndsAt: trialEnds,
      oldestUnpaidDueDate: oldestDue,
      graceDays,
      autoSuspend: settings.autoSuspend,
    })

    if (next === current) continue

    db.prepare(`UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ?`).run(next, at, id)
    report.subscriptionsAdvanced++

    const businessName = str(row, 'business_name')
    report.notes.push(`${businessName}: subscription ${current} → ${next}`)

    recordAudit({
      actorId: null,
      actorEmail: 'system@billing-engine',
      action: 'subscription.auto_transition',
      entityType: 'subscription',
      entityId: id,
      businessId,
      before: { status: current },
      after: { status: next },
    })

    // Suspension is the only transition that changes what customers see, so it
    // also flips the business record and is reported separately.
    if (next === 'suspended' && str(row, 'business_status') === 'active') {
      db.prepare(`UPDATE businesses SET status = 'suspended', updated_at = ? WHERE id = ?`).run(at, businessId)
      report.businessesSuspended++
      createNotification({
        businessId,
        title: 'Service suspended',
        body: 'Your account has been suspended for non-payment. Settle the outstanding invoice to restore access.',
        kind: 'billing',
        linkUrl: '/dashboard/billing',
      })
    } else if (next === 'active' && str(row, 'business_status') === 'suspended') {
      db.prepare(`UPDATE businesses SET status = 'active', updated_at = ? WHERE id = ?`).run(at, businessId)
      createNotification({
        businessId,
        title: 'Service restored',
        body: 'Payment received — your AR products are live again.',
        kind: 'success',
        linkUrl: '/dashboard',
      })
    }
  }
}

/* ── 4. reminders ───────────────────────────────────────────────────────── */

/**
 * Sends each active reminder rule once per invoice.
 *
 * Idempotency is enforced by the database, not by this function: notification_logs
 * has a unique index on (invoice_id, rule_id), so a duplicate insert is rejected
 * even if two ticks run concurrently. That is the only guarantee worth relying
 * on — a check-then-insert in application code would race.
 */
function dispatchReminders(at: string, report: TickReport): void {
  const db = getDb()

  const rules = db
    .prepare(`SELECT * FROM reminder_rules WHERE is_active = 1 ORDER BY sort_order`)
    .all() as Row[]
  if (rules.length === 0) return

  const invoices = db
    .prepare(
      `SELECT i.id, i.number, i.due_date, i.total_minor, i.paid_minor, i.currency,
              i.business_id, b.name AS business_name, b.email AS business_email
         FROM invoices i
         JOIN businesses b ON b.id = i.business_id
        WHERE i.deleted_at IS NULL
          AND i.status IN ('sent','partial','overdue')
          AND i.total_minor > i.paid_minor
          AND b.deleted_at IS NULL`,
    )
    .all() as Row[]

  for (const invoice of invoices) {
    const invoiceId = str(invoice, 'id')
    const dueDate = str(invoice, 'due_date')
    // Positive once the due date has passed; negative while it is still ahead.
    const daysPastDue = daysBetween(dueDate, at)
    const outstanding = num(invoice, 'total_minor') - num(invoice, 'paid_minor')
    const currency = (str(invoice, 'currency') || 'INR') as CurrencyCode

    for (const rule of rules) {
      const offset = num(rule, 'offset_days')
      // Fire once the threshold is reached, not only on the exact day — a
      // missed tick must not mean a permanently skipped reminder.
      if (daysPastDue < offset) continue

      const ruleId = str(rule, 'id')
      const vars: Record<string, string> = {
        number: str(invoice, 'number'),
        amount: formatMoney({ amount: outstanding, currency }),
        due_date: dueDate.slice(0, 10),
        business: str(invoice, 'business_name'),
      }
      const render = (template: string) =>
        template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')

      const subject = render(str(rule, 'subject'))
      const body = render(str(rule, 'body'))

      // No email provider is configured in the MVP, so the log records exactly
      // that rather than claiming a send that never happened.
      const status = 'skipped_no_provider'

      try {
        db.prepare(
          `INSERT INTO notification_logs
             (id, business_id, invoice_id, rule_id, recipient, channel, subject, content,
              status, provider, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?)`,
        ).run(
          uuid(),
          str(invoice, 'business_id'),
          invoiceId,
          ruleId,
          strOrNull(invoice, 'business_email') ?? '',
          str(rule, 'channel') || 'in_app',
          subject,
          body,
          status,
          at,
        )
      } catch {
        // Unique index hit: this reminder was already sent. Expected, not an error.
        continue
      }

      // The in-app notification always lands, provider or not — it is the one
      // channel that cannot fail for want of credentials.
      createNotification({
        businessId: str(invoice, 'business_id'),
        title: subject,
        body,
        kind: 'billing',
        linkUrl: '/dashboard/billing',
      })

      report.remindersSent++
      report.notes.push(`Reminder "${str(rule, 'name')}" for ${str(invoice, 'number')}`)
    }
  }
}

/* ── opportunistic trigger ──────────────────────────────────────────────── */

const MIN_INTERVAL_MS = 15 * 60 * 1000
let lastRunAt = 0

/**
 * Runs the tick at most every 15 minutes, from a normal page render.
 *
 * This is what makes the platform self-maintaining with no job runner at all:
 * an admin opening their dashboard is enough to keep billing current. The HTTP
 * cron endpoint and the CLI exist for deployments that want a real schedule;
 * this is the floor beneath them.
 *
 * Deliberately swallows errors — a billing hiccup must never blank a page.
 */
export function maybeRunBillingTick(): TickReport | null {
  const elapsed = Date.now() - lastRunAt
  if (elapsed < MIN_INTERVAL_MS) return null
  lastRunAt = Date.now()

  try {
    return runBillingTick()
  } catch (err) {
    console.error('[billing-engine] tick failed', err)
    return null
  }
}
