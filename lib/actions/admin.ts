'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/auth/guards'
import {
  setBusinessStatus, updateBusiness, updateSubscription, upsertPlan, setInternalNotes,
  getPlan, getBusinessById, getSubscription, createBusiness, addMember, createSubscription,
} from '@/lib/db/repositories/businesses'
import { createInvoice, recordPayment, setInvoiceStatus } from '@/lib/db/repositories/billing'
import {
  createLead, updateLead, moveLeadStage, addNote, addTask, completeTask,
  convertLeadToBusiness, deleteLead, replyToTicket, setTicketStatus,
} from '@/lib/db/repositories/crm'
import { recordAudit, setCmsSection, setSetting } from '@/lib/db/repositories/platform'
import { getDb, now, uuid, type Row, str } from '@/lib/db'
import { hashPassword } from '@/lib/auth/password'
import { slugify } from '@/lib/utils'
import { guarded, fail, type ActionResult } from '@/lib/auth/errors'
import { BUSINESS_CATEGORIES } from '@/config/terminology'
import { CRM_STAGES } from '@/types/domain'

/**
 * Super-admin server actions.
 *
 * Every one calls `requireSuperAdmin()` first — the guard is the authorization,
 * not the fact that these live under an /admin route. Anything that changes
 * money, access or availability is written to the audit log.
 */

const toPaise = (rupees: number) => Math.round(rupees * 100)

/* ── businesses ─────────────────────────────────────────────────────────── */

export async function setBusinessStatusAction(
  businessId: string,
  status: 'active' | 'suspended' | 'archived',
): Promise<void> {
  const admin = await requireSuperAdmin()
  const before = getBusinessById(businessId)
  setBusinessStatus(businessId, status)

  recordAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    action: `business.${status}`,
    entityType: 'business',
    entityId: businessId,
    businessId,
    before: { status: before?.status },
    after: { status },
  })

  revalidatePath('/admin/businesses')
  revalidatePath(`/admin/businesses/${businessId}`)
}

export async function saveInternalNotesAction(businessId: string, notes: string): Promise<void> {
  const admin = await requireSuperAdmin()
  // Lives in its own admin-only table; the business-facing profile action has
  // no path to it at all.
  setInternalNotes(businessId, notes, admin.id)
  recordAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'business.notes_updated',
    entityType: 'business',
    entityId: businessId,
    businessId,
  })
  revalidatePath(`/admin/businesses/${businessId}`)
}

const negotiatedSchema = z.object({
  planId: z.string().min(1),
  negotiatedPrice: z.coerce.number().min(0).max(10_000_000).optional(),
  status: z.enum(['trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled']),
  graceDays: z.coerce.number().int().min(0).max(90).default(7),
})

/** Changes a business's plan / negotiated price / status. Never edits the shared plan. */
export async function updateSubscriptionAction(
  businessId: string,
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const admin = await requireSuperAdmin()
  const parsed = negotiatedSchema.safeParse({
    planId: formData.get('planId'),
    negotiatedPrice: formData.get('negotiatedPrice') || undefined,
    status: formData.get('status'),
    graceDays: formData.get('graceDays') || 7,
  })
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.')

  const before = getSubscription(businessId)
  const plan = getPlan(parsed.data.planId)
  if (!plan) return fail('That plan no longer exists.')

  const negotiated =
    parsed.data.negotiatedPrice === undefined ? null : toPaise(parsed.data.negotiatedPrice)

  updateSubscription(businessId, {
    planId: parsed.data.planId,
    status: parsed.data.status,
    negotiatedPriceMinor: negotiated,
    graceDays: parsed.data.graceDays,
  })

  recordAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'subscription.updated',
    entityType: 'subscription',
    entityId: before?.id ?? null,
    businessId,
    before: { planId: before?.planId, status: before?.status, price: before?.negotiatedPriceMinor },
    after: { planId: parsed.data.planId, status: parsed.data.status, price: negotiated },
  })

  revalidatePath(`/admin/businesses/${businessId}`)
  return { ok: true, data: null }
}

const newBusinessSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  category: z.enum(BUSINESS_CATEGORIES),
  ownerName: z.string().trim().min(2).max(80),
  ownerEmail: z.string().trim().toLowerCase().email(),
  ownerPassword: z.string().min(10, 'Password must be at least 10 characters.'),
  planId: z.string().min(1),
})

export async function createBusinessAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const admin = await requireSuperAdmin()
  const parsed = newBusinessSchema.safeParse({
    businessName: formData.get('businessName'),
    category: formData.get('category'),
    ownerName: formData.get('ownerName'),
    ownerEmail: formData.get('ownerEmail'),
    ownerPassword: formData.get('ownerPassword'),
    planId: formData.get('planId'),
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(issue?.message ?? 'Check the form.', String(issue?.path[0] ?? ''))
  }
  const d = parsed.data
  const db = getDb()

  if (db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(d.ownerEmail)) {
    return fail('A user with that email already exists.', 'ownerEmail')
  }

  let slug = slugify(d.businessName) || `client-${Date.now().toString(36)}`
  let attempt = slug
  let n = 1
  while (db.prepare(`SELECT id FROM businesses WHERE slug = ?`).get(attempt)) attempt = `${slug}-${++n}`

  const plan = getPlan(d.planId)
  const passwordHash = await hashPassword(d.ownerPassword)
  const userId = uuid()

  db.exec('BEGIN')
  let businessId = ''
  try {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, is_super_admin, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
    ).run(userId, d.ownerEmail, passwordHash, d.ownerName, now(), now())

    businessId = createBusiness({
      name: d.businessName, slug: attempt, category: d.category, email: d.ownerEmail,
    })
    addMember(businessId, userId, 'owner')
    createSubscription({
      businessId, planId: d.planId, status: 'active', billingInterval: plan?.billingInterval,
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[admin.createBusiness]', err)
    return fail('Could not create the business. Please try again.')
  }

  recordAudit({
    actorId: admin.id, actorEmail: admin.email, action: 'business.created',
    entityType: 'business', entityId: businessId, businessId,
    after: { name: d.businessName, planId: d.planId },
  })

  revalidatePath('/admin/businesses')
  redirect(`/admin/businesses/${businessId}`)
}

/* ── plans ──────────────────────────────────────────────────────────────── */

const planSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().nullable(),
  price: z.coerce.number().min(0).max(10_000_000),
  setupFee: z.coerce.number().min(0).max(10_000_000),
  trialDays: z.coerce.number().int().min(0).max(365),
  maxProducts: z.string(),
  maxArModels: z.string(),
  maxQrCodes: z.string(),
  maxTeamMembers: z.string(),
  storageMb: z.string(),
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
})

/**
 * Parses a plan limit field.
 *
 * Empty or "unlimited" means NULL (no ceiling). Anything else must be a
 * non-negative integer.
 *
 * Returning a discriminated result rather than a bare `number | null` matters
 * more than it looks: the previous version collapsed unparseable input to null,
 * so a typo of "abc" or "-5" in the pricing editor silently granted every
 * business on that plan UNLIMITED products, models and QR codes. A validation
 * mistake must not be indistinguishable from a deliberate "no limit".
 */
type ParsedLimit = { ok: true; value: number | null } | { ok: false }

const toLimit = (raw: string): ParsedLimit => {
  const t = raw.trim()
  if (t === '' || t.toLowerCase() === 'unlimited') return { ok: true, value: null }

  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { ok: false }
  return { ok: true, value: n }
}

export async function savePlanAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const admin = await requireSuperAdmin()
  const parsed = planSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(issue?.message ?? 'Check the form.', String(issue?.path[0] ?? ''))
  }
  const d = parsed.data
  const existing = d.id ? getPlan(d.id) : null

  const features = {
    advanced_analytics: formData.get('advanced_analytics') === 'on',
    custom_branding: formData.get('custom_branding') === 'on',
    white_label: formData.get('white_label') === 'on',
    custom_domain: formData.get('custom_domain') === 'on',
    team_members: formData.get('team_members') === 'on',
    api_access: formData.get('api_access') === 'on',
    priority_support: formData.get('priority_support') === 'on',
    model_generation: formData.get('model_generation') === 'on',
  }

  // Every limit is validated before ANY of them is written. A rejected field
  // must not leave the plan half-updated with the others already applied.
  const limitFields: Array<[label: string, raw: string]> = [
    ['Products', d.maxProducts],
    ['AR models', d.maxArModels],
    ['QR codes', d.maxQrCodes],
    ['Team members', d.maxTeamMembers],
    ['Storage (MB)', d.storageMb],
  ]

  const limits: Array<number | null> = []
  for (const [label, raw] of limitFields) {
    const result = toLimit(raw)
    if (!result.ok) {
      return fail(
        `“${label}” must be a whole number of 0 or more, or left blank for unlimited. ` +
          `Got “${raw.trim()}”.`,
      )
    }
    limits.push(result.value)
  }
  const [maxProducts, maxArModels, maxQrCodes, maxTeamMembers, storageMb] = limits

  upsertPlan({
    id: d.id || undefined,
    slug: slugify(d.slug) || slugify(d.name),
    name: d.name,
    description: d.description ?? null,
    priceMinor: toPaise(d.price),
    currency: 'INR',
    billingInterval: 'monthly',
    setupFeeMinor: toPaise(d.setupFee),
    trialDays: d.trialDays,
    isPublic: formData.get('isPublic') === 'on',
    sortOrder: d.sortOrder,
    archived: formData.get('archived') === 'on',
    limits: {
      maxProducts: maxProducts ?? null,
      maxArModels: maxArModels ?? null,
      maxQrCodes: maxQrCodes ?? null,
      maxTeamMembers: maxTeamMembers ?? null,
      maxStorageBytes:
        storageMb === null || storageMb === undefined ? null : storageMb * 1024 * 1024,
      maxMonthlyScans: null,
    },
    features,
  })

  recordAudit({
    actorId: admin.id, actorEmail: admin.email,
    action: existing ? 'plan.updated' : 'plan.created',
    entityType: 'plan', entityId: d.id ?? null,
    before: existing ? { price: existing.priceMinor, limits: existing.limits } : null,
    after: { price: toPaise(d.price) },
  })

  revalidatePath('/admin/pricing')
  revalidatePath('/')
  return { ok: true, data: null }
}

/* ── invoices & payments ────────────────────────────────────────────────── */

export async function createInvoiceAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const admin = await requireSuperAdmin()
    const businessId = String(formData.get('businessId') ?? '')
    if (!businessId) throw new Error('Choose a business.')

    const descriptions = formData.getAll('itemDescription').map(String)
    const amounts = formData.getAll('itemAmount').map((v) => Number(v))
    const kinds = formData.getAll('itemKind').map(String)

    const items = descriptions
      .map((description, i) => ({
        description: description.trim(),
        unitMinor: toPaise(amounts[i] ?? 0),
        kind: (kinds[i] ?? 'custom') as 'subscription' | 'setup_fee' | 'model' | 'custom',
      }))
      .filter((i) => i.description && i.unitMinor > 0)

    if (!items.length) throw new Error('Add at least one line item with an amount.')

    const dueDate = String(formData.get('dueDate') ?? '')
    if (!dueDate) throw new Error('Set a due date.')

    const invoiceId = createInvoice({
      businessId,
      items,
      taxName: String(formData.get('taxName') ?? '') || null,
      taxPercent: Number(formData.get('taxPercent') ?? 0),
      discountMinor: toPaise(Number(formData.get('discount') ?? 0)),
      dueDate: new Date(dueDate).toISOString(),
      status: 'sent',
      notes: String(formData.get('notes') ?? '') || null,
    })

    recordAudit({
      actorId: admin.id, actorEmail: admin.email, action: 'invoice.created',
      entityType: 'invoice', entityId: invoiceId, businessId,
    })

    revalidatePath('/admin/invoices')
    return null
  })
}

export async function recordPaymentAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const admin = await requireSuperAdmin()
    const invoiceId = String(formData.get('invoiceId') ?? '')
    const businessId = String(formData.get('businessId') ?? '')
    const amount = Number(formData.get('amount') ?? 0)

    if (!invoiceId || !businessId) throw new Error('Missing invoice.')
    if (!(amount > 0)) throw new Error('Enter a payment amount.')

    recordPayment({
      businessId,
      invoiceId,
      amountMinor: toPaise(amount),
      method: String(formData.get('method') ?? 'cash') as 'cash' | 'bank_transfer' | 'upi' | 'razorpay' | 'other',
      reference: String(formData.get('reference') ?? '') || null,
      notes: String(formData.get('notes') ?? '') || null,
      recordedBy: admin.id,
    })

    recordAudit({
      actorId: admin.id, actorEmail: admin.email, action: 'payment.recorded',
      entityType: 'invoice', entityId: invoiceId, businessId,
      after: { amountMinor: toPaise(amount) },
    })

    revalidatePath('/admin/invoices')
    revalidatePath(`/admin/invoices/${invoiceId}`)
    return null
  })
}

export async function setInvoiceStatusAction(invoiceId: string, status: string): Promise<void> {
  const admin = await requireSuperAdmin()
  const allowed = ['draft', 'sent', 'paid', 'partial', 'overdue', 'cancelled']
  if (!allowed.includes(status)) return
  setInvoiceStatus(invoiceId, status as 'draft')
  recordAudit({
    actorId: admin.id, actorEmail: admin.email, action: 'invoice.status_changed',
    entityType: 'invoice', entityId: invoiceId, after: { status },
  })
  revalidatePath('/admin/invoices')
}

/* ── offers & coupons ───────────────────────────────────────────────────── */

export async function savePromotionAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const admin = await requireSuperAdmin()
    const name = String(formData.get('name') ?? '').trim()
    if (name.length < 2) throw new Error('Give the campaign a name.')

    const id = String(formData.get('id') ?? '') || uuid()
    const db = getDb()
    const exists = db.prepare(`SELECT id FROM promotions WHERE id = ?`).get(id)

    const values = [
      name,
      String(formData.get('description') ?? '') || null,
      String(formData.get('discountType') ?? 'percentage'),
      Number(formData.get('discountValue') ?? 0),
      String(formData.get('couponCode') ?? '').trim().toUpperCase() || null,
      new Date(String(formData.get('startsAt'))).toISOString(),
      new Date(String(formData.get('endsAt'))).toISOString(),
      String(formData.get('bannerTitle') ?? '') || null,
      String(formData.get('bannerMessage') ?? '') || null,
      String(formData.get('bannerCtaLabel') ?? '') || null,
      String(formData.get('bannerCtaUrl') ?? '') || null,
      String(formData.get('bannerColor') ?? '') || null,
      formData.get('showBanner') === 'on' ? 1 : 0,
      formData.get('isActive') === 'on' ? 1 : 0,
    ]

    if (exists) {
      db.prepare(
        `UPDATE promotions SET name=?, description=?, discount_type=?, discount_value=?,
           coupon_code=?, starts_at=?, ends_at=?, banner_title=?, banner_message=?,
           banner_cta_label=?, banner_cta_url=?, banner_color=?, show_banner=?, is_active=?,
           updated_at=? WHERE id=?`,
      ).run(...values, now(), id)
    } else {
      db.prepare(
        `INSERT INTO promotions (id, name, description, discount_type, discount_value, coupon_code,
           starts_at, ends_at, banner_title, banner_message, banner_cta_label, banner_cta_url,
           banner_color, show_banner, is_active, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, ...values, now(), now())
    }

    recordAudit({
      actorId: admin.id, actorEmail: admin.email,
      action: exists ? 'promotion.updated' : 'promotion.created',
      entityType: 'promotion', entityId: id,
    })

    revalidatePath('/admin/offers')
    revalidatePath('/')
    return null
  })
}

export async function saveCouponAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const admin = await requireSuperAdmin()
    const code = String(formData.get('code') ?? '').trim().toUpperCase()
    if (code.length < 3) throw new Error('Coupon code must be at least 3 characters.')

    const db = getDb()
    const existing = db.prepare(`SELECT id FROM coupons WHERE code = ?`).get(code) as Row | undefined
    const id = existing ? str(existing, 'id') : uuid()

    const args = [
      code,
      String(formData.get('description') ?? '') || null,
      String(formData.get('discountType') ?? 'percentage'),
      // Percentage stays a plain number; a fixed amount is money, so paise.
      String(formData.get('discountType')) === 'fixed'
        ? toPaise(Number(formData.get('discountValue') ?? 0))
        : Number(formData.get('discountValue') ?? 0),
      String(formData.get('duration') ?? 'once'),
      String(formData.get('expiresAt')) ? new Date(String(formData.get('expiresAt'))).toISOString() : null,
      formData.get('maxRedemptions') ? Number(formData.get('maxRedemptions')) : null,
      Number(formData.get('perBusinessLimit') ?? 1),
      formData.get('isActive') === 'on' ? 1 : 0,
    ]

    if (existing) {
      db.prepare(
        `UPDATE coupons SET code=?, description=?, discount_type=?, discount_value=?, duration=?,
           expires_at=?, max_redemptions=?, per_business_limit=?, is_active=?, updated_at=? WHERE id=?`,
      ).run(...args, now(), id)
    } else {
      db.prepare(
        `INSERT INTO coupons (id, code, description, discount_type, discount_value, duration,
           expires_at, max_redemptions, per_business_limit, is_active, redemption_count, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      ).run(id, ...args, now(), now())
    }

    recordAudit({
      actorId: admin.id, actorEmail: admin.email,
      action: existing ? 'coupon.updated' : 'coupon.created',
      entityType: 'coupon', entityId: id,
    })

    revalidatePath('/admin/offers')
    return null
  })
}

/* ── CRM ────────────────────────────────────────────────────────────────── */

export async function createLeadAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const admin = await requireSuperAdmin()
    const name = String(formData.get('name') ?? '').trim()
    const businessName = String(formData.get('businessName') ?? '').trim()
    if (name.length < 2) throw new Error('Enter a contact name.')
    if (businessName.length < 2) throw new Error('Enter the business name.')

    const id = createLead({
      name,
      businessName,
      businessType: String(formData.get('businessType') ?? '') || null,
      phone: String(formData.get('phone') ?? '') || null,
      email: String(formData.get('email') ?? '') || null,
      city: String(formData.get('city') ?? '') || null,
      source: String(formData.get('source') ?? '') || null,
      stage: (String(formData.get('stage') ?? 'new') as (typeof CRM_STAGES)[number]),
      expectedValueMinor: toPaise(Number(formData.get('expectedValue') ?? 0)),
      assignedTo: admin.id,
      nextFollowUpAt: String(formData.get('nextFollowUpAt'))
        ? new Date(String(formData.get('nextFollowUpAt'))).toISOString()
        : null,
    })

    revalidatePath('/admin/crm')
    revalidatePath(`/admin/crm/${id}`)
    return null
  })
}

export async function moveLeadStageAction(leadId: string, stage: string): Promise<void> {
  const admin = await requireSuperAdmin()
  if (!CRM_STAGES.includes(stage as (typeof CRM_STAGES)[number])) return
  moveLeadStage(leadId, stage as (typeof CRM_STAGES)[number], admin.id)
  revalidatePath('/admin/crm')
}

export async function addLeadNoteAction(leadId: string, body: string): Promise<void> {
  const admin = await requireSuperAdmin()
  const trimmed = body.trim()
  if (!trimmed) return
  addNote(leadId, admin.id, trimmed.slice(0, 2000))
  revalidatePath(`/admin/crm/${leadId}`)
}

export async function addLeadTaskAction(
  leadId: string,
  title: string,
  dueAt: string,
): Promise<void> {
  const admin = await requireSuperAdmin()
  const trimmed = title.trim()
  if (!trimmed) return
  addTask({
    leadId,
    title: trimmed.slice(0, 160),
    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    assignedTo: admin.id,
  })
  revalidatePath(`/admin/crm/${leadId}`)
  revalidatePath('/admin')
}

export async function completeTaskAction(taskId: string): Promise<void> {
  await requireSuperAdmin()
  completeTask(taskId)
  revalidatePath('/admin')
  revalidatePath('/admin/crm')
}

export async function deleteLeadAction(leadId: string): Promise<void> {
  await requireSuperAdmin()
  deleteLead(leadId)
  revalidatePath('/admin/crm')
  redirect('/admin/crm')
}

export async function convertLeadAction(
  leadId: string,
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const admin = await requireSuperAdmin()
    const email = String(formData.get('ownerEmail') ?? '').trim().toLowerCase()
    const password = String(formData.get('ownerPassword') ?? '')
    const ownerName = String(formData.get('ownerName') ?? '').trim()
    const planId = String(formData.get('planId') ?? '')
    const category = String(formData.get('category') ?? 'other')

    if (!email.includes('@')) throw new Error('Enter the owner’s email.')
    if (password.length < 10) throw new Error('Password must be at least 10 characters.')
    if (!planId) throw new Error('Choose a plan.')

    const db = getDb()
    if (db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(email)) {
      throw new Error('A user with that email already exists.')
    }

    const userId = uuid()
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, is_super_admin, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
    ).run(userId, email, await hashPassword(password), ownerName || email, now(), now())

    const negotiated = formData.get('negotiatedPrice')
      ? toPaise(Number(formData.get('negotiatedPrice')))
      : null

    const result = convertLeadToBusiness({
      leadId,
      ownerUserId: userId,
      planId,
      category: category as (typeof BUSINESS_CATEGORIES)[number],
      negotiatedPriceMinor: negotiated,
      includeSetupFee: formData.get('includeSetupFee') === 'on',
      actorId: admin.id,
    })

    recordAudit({
      actorId: admin.id, actorEmail: admin.email, action: 'lead.converted',
      entityType: 'lead', entityId: leadId, businessId: result.businessId,
      after: { businessId: result.businessId, invoiceId: result.invoiceId },
    })

    revalidatePath('/admin/crm')
    revalidatePath('/admin/businesses')
    return null
  })
}

/* ── CMS & settings ─────────────────────────────────────────────────────── */

export async function saveCmsSectionAction(key: string, json: string): Promise<ActionResult<null>> {
  return guarded(async () => {
    const admin = await requireSuperAdmin()
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      throw new Error('That isn’t valid JSON. Check for a missing comma or quote.')
    }
    setCmsSection(key, parsed)
    recordAudit({
      actorId: admin.id, actorEmail: admin.email, action: 'cms.updated',
      entityType: 'cms_section', entityId: key,
    })
    revalidatePath('/')
    revalidatePath('/admin/content')
    return null
  })
}

export async function saveBrandingAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const admin = await requireSuperAdmin()
    setSetting('branding', {
      name: String(formData.get('name') ?? 'GENIE').trim(),
      tagline: String(formData.get('tagline') ?? '').trim(),
      logoUrl: String(formData.get('logoUrl') ?? '') || null,
      faviconEmoji: String(formData.get('faviconEmoji') ?? '📦').slice(0, 4),
      primaryColor: String(formData.get('primaryColor') ?? '#5b3df5'),
      supportEmail: String(formData.get('supportEmail') ?? ''),
      supportPhone: String(formData.get('supportPhone') ?? ''),
    })
    recordAudit({
      actorId: admin.id, actorEmail: admin.email, action: 'branding.updated',
      entityType: 'settings', entityId: 'branding',
    })
    revalidatePath('/', 'layout')
    return null
  })
}

export async function saveFeatureFlagsAction(flags: Record<string, boolean>): Promise<void> {
  const admin = await requireSuperAdmin()
  setSetting('feature_flags', flags)
  recordAudit({
    actorId: admin.id, actorEmail: admin.email, action: 'feature_flags.updated',
    entityType: 'settings', entityId: 'feature_flags', after: flags,
  })
  revalidatePath('/admin/settings')
}

export async function saveTaxSettingsAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    await requireSuperAdmin()
    setSetting('tax', {
      enabled: formData.get('enabled') === 'on',
      name: String(formData.get('name') ?? 'GST'),
      percent: Number(formData.get('percent') ?? 0),
      taxId: String(formData.get('taxId') ?? ''),
    })
    revalidatePath('/admin/settings')
    return null
  })
}

/* ── support ────────────────────────────────────────────────────────────── */

export async function adminReplyTicketAction(ticketId: string, body: string): Promise<void> {
  const admin = await requireSuperAdmin()
  const trimmed = body.trim()
  if (!trimmed) return
  replyToTicket({ ticketId, authorId: admin.id, isStaff: true, body: trimmed })
  revalidatePath('/admin/support')
}

export async function closeTicketAction(ticketId: string): Promise<void> {
  await requireSuperAdmin()
  setTicketStatus(ticketId, 'closed')
  revalidatePath('/admin/support')
}
