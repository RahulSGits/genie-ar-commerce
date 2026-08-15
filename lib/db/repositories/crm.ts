import 'server-only'

import {
  getDb, now, uuid, str, strOrNull, num, param, transaction,
  type Row, type SqlParam,
} from '@/lib/db'
import { createBusiness, createSubscription, addMember, getPlan } from '@/lib/db/repositories/businesses'
import { createInvoice } from '@/lib/db/repositories/billing'
import { slugify } from '@/lib/utils'
import type {
  CrmActivity, CrmLead, CrmNote, CrmStage, CrmTask, InvoiceItemKind,
  SupportTicket, TicketMessage,
} from '@/types/domain'
import type { BusinessCategory } from '@/config/terminology'

/* ── mappers ────────────────────────────────────────────────────────────── */

function mapLead(row: Row): CrmLead {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    businessName: str(row, 'business_name'),
    businessType: strOrNull(row, 'business_type'),
    phone: strOrNull(row, 'phone'),
    email: strOrNull(row, 'email'),
    city: strOrNull(row, 'city'),
    website: strOrNull(row, 'website'),
    instagram: strOrNull(row, 'instagram'),
    source: strOrNull(row, 'source'),
    stage: (str(row, 'stage') || 'new') as CrmStage,
    expectedValueMinor: num(row, 'expected_value_minor'),
    interestedPlanId: strOrNull(row, 'interested_plan_id'),
    assignedTo: strOrNull(row, 'assigned_to'),
    convertedBusinessId: strOrNull(row, 'converted_business_id'),
    nextFollowUpAt: strOrNull(row, 'next_follow_up_at'),
    lastContactAt: strOrNull(row, 'last_contact_at'),
    lostReason: strOrNull(row, 'lost_reason'),
    sortOrder: num(row, 'sort_order'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  }
}

/* ── leads ──────────────────────────────────────────────────────────────── */

export function listLeads(filters: { search?: string; stage?: CrmStage | 'all' } = {}): CrmLead[] {
  const where = ['deleted_at IS NULL']
  const params: SqlParam[] = []

  if (filters.search) {
    where.push('(name LIKE ? OR business_name LIKE ? OR email LIKE ? OR phone LIKE ?)')
    const q = `%${filters.search}%`
    params.push(q, q, q, q)
  }
  if (filters.stage && filters.stage !== 'all') {
    where.push('stage = ?')
    params.push(param(filters.stage))
  }

  const rows = getDb()
    .prepare(
      `SELECT * FROM crm_leads
        WHERE ${where.join(' AND ')}
        ORDER BY sort_order ASC, created_at DESC`,
    )
    .all(...params) as Row[]
  return rows.map(mapLead)
}

export function getLead(id: string): CrmLead | null {
  const row = getDb()
    .prepare(`SELECT * FROM crm_leads WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as Row | undefined
  return row ? mapLead(row) : null
}

export function createLead(input: {
  name: string
  businessName: string
  businessType?: string | null
  phone?: string | null
  email?: string | null
  city?: string | null
  source?: string | null
  stage?: CrmStage
  expectedValueMinor?: number
  assignedTo?: string | null
  nextFollowUpAt?: string | null
}): string {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO crm_leads
         (id, name, business_name, business_type, phone, email, city, source, stage,
          expected_value_minor, assigned_to, next_follow_up_at, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      id, input.name, input.businessName, input.businessType ?? null,
      input.phone ?? null, input.email ?? null, input.city ?? null,
      input.source ?? null, input.stage ?? 'new', input.expectedValueMinor ?? 0,
      input.assignedTo ?? null, input.nextFollowUpAt ?? null, ts, ts,
    )
  return id
}

const LEAD_COLUMNS: Record<string, string> = {
  name: 'name', businessName: 'business_name', businessType: 'business_type',
  phone: 'phone', email: 'email', city: 'city', website: 'website',
  instagram: 'instagram', source: 'source', stage: 'stage',
  expectedValueMinor: 'expected_value_minor', interestedPlanId: 'interested_plan_id',
  assignedTo: 'assigned_to', nextFollowUpAt: 'next_follow_up_at',
  lastContactAt: 'last_contact_at', lostReason: 'lost_reason', sortOrder: 'sort_order',
}

export function updateLead(id: string, patch: Record<string, unknown>): void {
  const sets: string[] = []
  const params: SqlParam[] = []
  for (const [k, v] of Object.entries(patch)) {
    const col = LEAD_COLUMNS[k]
    if (!col) continue
    sets.push(`${col} = ?`)
    params.push(param(v))
  }
  if (!sets.length) return
  sets.push('updated_at = ?')
  params.push(now(), id)
  getDb().prepare(`UPDATE crm_leads SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

/** Stage change + activity entry, so the pipeline always has an audit trail. */
export function moveLeadStage(id: string, stage: CrmStage, actorId: string | null): void {
  transaction(() => {
    const current = getLead(id)
    if (!current || current.stage === stage) {
      if (current) updateLead(id, { stage })
      return
    }
    updateLead(id, { stage, lastContactAt: now() })
    recordActivity(id, actorId, 'stage_changed', current.stage, stage)
  })
}

export function deleteLead(id: string): void {
  getDb().prepare(`UPDATE crm_leads SET deleted_at = ? WHERE id = ?`).run(now(), id)
}

/* ── notes / tasks / activity ───────────────────────────────────────────── */

export function listNotes(leadId: string): CrmNote[] {
  const rows = getDb()
    .prepare(
      `SELECT n.*, u.full_name AS author_name
         FROM crm_notes n LEFT JOIN users u ON u.id = n.author_id
        WHERE n.lead_id = ? ORDER BY n.created_at DESC`,
    )
    .all(leadId) as Row[]
  return rows.map((r) => ({
    id: str(r, 'id'),
    leadId: str(r, 'lead_id'),
    authorId: strOrNull(r, 'author_id'),
    authorName: strOrNull(r, 'author_name'),
    body: str(r, 'body'),
    createdAt: str(r, 'created_at'),
  }))
}

export function addNote(leadId: string, authorId: string | null, body: string): void {
  getDb()
    .prepare(`INSERT INTO crm_notes (id, lead_id, author_id, body, created_at) VALUES (?,?,?,?,?)`)
    .run(uuid(), leadId, authorId, body, now())
  updateLead(leadId, { lastContactAt: now() })
}

export function listTasks(opts: { leadId?: string; openOnly?: boolean } = {}): CrmTask[] {
  const where: string[] = []
  const params: SqlParam[] = []
  if (opts.leadId) {
    where.push('t.lead_id = ?')
    params.push(param(opts.leadId))
  }
  if (opts.openOnly) where.push('t.completed_at IS NULL')

  const rows = getDb()
    .prepare(
      `SELECT t.*, l.business_name AS lead_name
         FROM crm_tasks t LEFT JOIN crm_leads l ON l.id = t.lead_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.due_at ASC NULLS LAST
        LIMIT 100`,
    )
    .all(...params) as Row[]

  return rows.map((r) => ({
    id: str(r, 'id'),
    leadId: strOrNull(r, 'lead_id'),
    title: str(r, 'title'),
    dueAt: strOrNull(r, 'due_at'),
    completedAt: strOrNull(r, 'completed_at'),
    assignedTo: strOrNull(r, 'assigned_to'),
    createdAt: str(r, 'created_at'),
    leadName: strOrNull(r, 'lead_name'),
  }))
}

export function addTask(input: {
  leadId?: string | null
  title: string
  dueAt?: string | null
  assignedTo?: string | null
}): void {
  getDb()
    .prepare(
      `INSERT INTO crm_tasks (id, lead_id, title, due_at, assigned_to, created_at) VALUES (?,?,?,?,?,?)`,
    )
    .run(uuid(), input.leadId ?? null, input.title, input.dueAt ?? null, input.assignedTo ?? null, now())
}

export function completeTask(id: string): void {
  getDb().prepare(`UPDATE crm_tasks SET completed_at = ? WHERE id = ?`).run(now(), id)
}

export function recordActivity(
  leadId: string,
  actorId: string | null,
  action: string,
  from?: string | null,
  to?: string | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO crm_activities (id, lead_id, actor_id, action, from_value, to_value, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(uuid(), leadId, actorId, action, from ?? null, to ?? null, now())
}

export function listActivity(leadId: string): CrmActivity[] {
  const rows = getDb()
    .prepare(
      `SELECT a.*, u.full_name AS actor_name
         FROM crm_activities a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.lead_id = ? ORDER BY a.created_at DESC LIMIT 50`,
    )
    .all(leadId) as Row[]
  return rows.map((r) => ({
    id: str(r, 'id'),
    leadId: str(r, 'lead_id'),
    actorId: strOrNull(r, 'actor_id'),
    actorName: strOrNull(r, 'actor_name'),
    action: str(r, 'action'),
    fromValue: strOrNull(r, 'from_value'),
    toValue: strOrNull(r, 'to_value'),
    createdAt: str(r, 'created_at'),
  }))
}

/* ── conversion ─────────────────────────────────────────────────────────── */

export type ConversionResult = { businessId: string; invoiceId: string | null }

/**
 * Lead → paying client, in one transaction.
 *
 * Creates the business, its owner membership, a subscription at the negotiated
 * price, and an opening invoice covering setup + first period. Partial success
 * here would leave an unusable tenant and an unbillable customer, so it is all
 * or nothing.
 */
export function convertLeadToBusiness(input: {
  leadId: string
  ownerUserId: string
  planId: string
  category: BusinessCategory
  negotiatedPriceMinor?: number | null
  includeSetupFee?: boolean
  actorId: string | null
}): ConversionResult {
  return transaction(() => {
    const lead = getLead(input.leadId)
    if (!lead) throw new Error('Lead not found.')
    if (lead.convertedBusinessId) throw new Error('This lead has already been converted.')

    const plan = getPlan(input.planId)
    if (!plan) throw new Error('Plan not found.')

    let slug = slugify(lead.businessName) || `client-${Date.now().toString(36)}`
    const db = getDb()
    let attempt = slug
    let n = 1
    while (db.prepare(`SELECT id FROM businesses WHERE slug = ?`).get(attempt)) {
      attempt = `${slug}-${++n}`
    }

    const businessId = createBusiness({
      name: lead.businessName,
      slug: attempt,
      category: input.category,
      email: lead.email,
      phone: lead.phone,
      city: lead.city,
    })
    addMember(businessId, input.ownerUserId, 'owner')

    createSubscription({
      businessId,
      planId: input.planId,
      status: 'active',
      negotiatedPriceMinor: input.negotiatedPriceMinor ?? null,
      billingInterval: plan.billingInterval,
    })

    const price = input.negotiatedPriceMinor ?? plan.priceMinor
    const items: Array<{ description: string; unitMinor: number; kind: InvoiceItemKind }> = [
      { description: `${plan.name} — first period`, unitMinor: price, kind: 'subscription' },
    ]
    if (input.includeSetupFee && plan.setupFeeMinor > 0) {
      items.unshift({
        description: 'AR setup fee',
        unitMinor: plan.setupFeeMinor,
        kind: 'setup_fee',
      })
    }

    const due = new Date()
    due.setDate(due.getDate() + 7)

    const invoiceId = createInvoice({
      businessId,
      items,
      dueDate: due.toISOString(),
      status: 'sent',
      currency: plan.currency,
    })

    updateLead(input.leadId, { stage: 'won', convertedBusinessId: businessId })
    recordActivity(input.leadId, input.actorId, 'converted', lead.stage, 'won')

    return { businessId, invoiceId }
  })
}

export type PipelineSummary = {
  stage: CrmStage
  count: number
  valueMinor: number
}

export function getPipelineSummary(): PipelineSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT stage, COUNT(*) AS c, COALESCE(SUM(expected_value_minor),0) AS v
         FROM crm_leads WHERE deleted_at IS NULL GROUP BY stage`,
    )
    .all() as Row[]
  return rows.map((r) => ({
    stage: str(r, 'stage') as CrmStage,
    count: num(r, 'c'),
    valueMinor: num(r, 'v'),
  }))
}

/* ── support tickets ────────────────────────────────────────────────────── */

export function listTickets(opts: { businessId?: string; status?: string } = {}): SupportTicket[] {
  const where: string[] = []
  const params: SqlParam[] = []
  if (opts.businessId) {
    where.push('t.business_id = ?')
    params.push(param(opts.businessId))
  }
  if (opts.status && opts.status !== 'all') {
    where.push('t.status = ?')
    params.push(param(opts.status))
  }

  const rows = getDb()
    .prepare(
      `SELECT t.*, b.name AS business_name,
              (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
         FROM support_tickets t JOIN businesses b ON b.id = t.business_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.updated_at DESC LIMIT 100`,
    )
    .all(...params) as Row[]

  return rows.map((r) => ({
    id: str(r, 'id'),
    businessId: str(r, 'business_id'),
    openedBy: strOrNull(r, 'opened_by'),
    subject: str(r, 'subject'),
    category: (str(r, 'category') || 'technical') as SupportTicket['category'],
    priority: (str(r, 'priority') || 'normal') as SupportTicket['priority'],
    status: (str(r, 'status') || 'open') as SupportTicket['status'],
    createdAt: str(r, 'created_at'),
    updatedAt: str(r, 'updated_at'),
    businessName: strOrNull(r, 'business_name') ?? undefined,
    messageCount: num(r, 'message_count'),
  }))
}

export function createTicket(input: {
  businessId: string
  openedBy: string
  subject: string
  category: string
  priority: string
  body: string
}): string {
  return transaction(() => {
    const id = uuid()
    const ts = now()
    getDb()
      .prepare(
        `INSERT INTO support_tickets (id, business_id, opened_by, subject, category, priority, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'open',?,?)`,
      )
      .run(id, input.businessId, input.openedBy, input.subject, input.category, input.priority, ts, ts)

    getDb()
      .prepare(
        `INSERT INTO ticket_messages (id, ticket_id, author_id, is_staff, body, created_at) VALUES (?,?,?,0,?,?)`,
      )
      .run(uuid(), id, input.openedBy, input.body, ts)
    return id
  })
}

export function getTicketMessages(ticketId: string): TicketMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT m.*, u.full_name AS author_name
         FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
        WHERE m.ticket_id = ? ORDER BY m.created_at ASC`,
    )
    .all(ticketId) as Row[]
  return rows.map((r) => ({
    id: str(r, 'id'),
    ticketId: str(r, 'ticket_id'),
    authorId: strOrNull(r, 'author_id'),
    authorName: strOrNull(r, 'author_name'),
    isStaff: num(r, 'is_staff') === 1,
    body: str(r, 'body'),
    createdAt: str(r, 'created_at'),
  }))
}

export function replyToTicket(input: {
  ticketId: string
  authorId: string
  isStaff: boolean
  body: string
}): void {
  transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO ticket_messages (id, ticket_id, author_id, is_staff, body, created_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(uuid(), input.ticketId, input.authorId, input.isStaff ? 1 : 0, input.body, now())
    getDb()
      .prepare(`UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?`)
      .run(input.isStaff ? 'pending' : 'open', now(), input.ticketId)
  })
}

export function setTicketStatus(id: string, status: string): void {
  getDb().prepare(`UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?`).run(status, now(), id)
}
