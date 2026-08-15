import type { BusinessCategory, PlacementMode } from '@/config/terminology'
import type { CurrencyCode } from '@/utils/money'
import type {
  PlanFeatures,
  PlanLimits,
  SubscriptionStatus,
} from '@/lib/billing/entitlements'
import type { LengthUnit } from '@/types/ar'

/* ── identity ───────────────────────────────────────────────────────────── */

export type User = {
  id: string
  email: string
  fullName: string
  avatarUrl: string | null
  isSuperAdmin: boolean
  lastLoginAt: string | null
  createdAt: string
}

export type BusinessRole = 'owner' | 'admin' | 'member'

export type BusinessMember = {
  id: string
  businessId: string
  userId: string
  role: BusinessRole
  email: string
  fullName: string
  createdAt: string
}

/* ── tenant ─────────────────────────────────────────────────────────────── */

export type BusinessStatus = 'active' | 'suspended' | 'archived'

export type Business = {
  id: string
  slug: string
  name: string
  category: BusinessCategory
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  brandColor: string | null

  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  websiteUrl: string | null
  instagramUrl: string | null
  facebookUrl: string | null
  whatsappNumber: string | null
  mapsUrl: string | null

  menuUrl: string | null
  orderingUrl: string | null
  reservationUrl: string | null
  storeUrl: string | null
  openingHours: Record<string, string> | null

  currency: CurrencyCode
  timezone: string
  status: BusinessStatus

  createdAt: string
  updatedAt: string
}

/* ── plans & subscriptions ──────────────────────────────────────────────── */

export type BillingInterval = 'monthly' | 'yearly'

export type SubscriptionPlan = {
  id: string
  slug: string
  name: string
  description: string | null
  priceMinor: number
  currency: CurrencyCode
  billingInterval: BillingInterval
  setupFeeMinor: number
  limits: PlanLimits
  features: PlanFeatures
  trialDays: number
  isPublic: boolean
  sortOrder: number
  archived: boolean
}

export type Subscription = {
  id: string
  businessId: string
  planId: string
  status: SubscriptionStatus
  /** Negotiated price for this business only; the shared plan is untouched. */
  negotiatedPriceMinor: number | null
  limitsOverride: Partial<PlanLimits> | null
  featuresOverride: Partial<PlanFeatures> | null
  billingInterval: BillingInterval
  trialEndsAt: string | null
  currentPeriodStart: string
  currentPeriodEnd: string
  graceDays: number
  cancelledAt: string | null
  createdAt: string
}

/** What a business actually pays, after any negotiated override. */
export function effectivePriceMinor(sub: Subscription, plan: SubscriptionPlan): number {
  return sub.negotiatedPriceMinor ?? plan.priceMinor
}

/* ── catalog ────────────────────────────────────────────────────────────── */

export type ModelStatus = 'processing' | 'ready' | 'failed'

export type ThreeDModel = {
  id: string
  businessId: string
  name: string
  glbUrl: string | null
  usdzUrl: string | null
  posterUrl: string | null
  fileSizeBytes: number
  format: string | null
  triangleCount: number | null
  status: ModelStatus
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export type MenuCategory = {
  id: string
  businessId: string
  name: string
  slug: string
  description: string | null
  sortOrder: number
  isPublished: boolean
  productCount?: number
}

export type ProductStatus = 'draft' | 'published' | 'archived'
export type DietTag = 'veg' | 'non-veg' | 'egg'

export type Product = {
  id: string
  businessId: string
  categoryId: string | null
  modelId: string | null

  name: string
  slug: string
  description: string | null
  shortDescription: string | null
  sku: string | null

  priceMinor: number | null
  compareAtMinor: number | null
  currency: CurrencyCode

  imageUrl: string | null
  thumbnailUrl: string | null

  dimWidth: number | null
  dimHeight: number | null
  dimDepth: number | null
  dimUnit: LengthUnit
  weightGrams: number | null

  placement: PlacementMode
  scaleMultiplier: number
  rotationY: number
  arEnabled: boolean

  ctaLabel: string | null
  ctaUrl: string | null

  status: ProductStatus
  isFeatured: boolean
  isBestseller: boolean
  isAvailable: boolean
  sortOrder: number

  tags: string[]
  allergens: string[]
  diet: DietTag | null
  materials: string[]
  colors: string[]
  sizes: string[]

  createdAt: string
  updatedAt: string
}

/** Product joined with its model, as the dashboard lists need it. */
export type ProductWithModel = Product & {
  model: ThreeDModel | null
  categoryName: string | null
  qrCount: number
}

/* ── QR ─────────────────────────────────────────────────────────────────── */

export type QrDestination = 'ar' | 'product' | 'menu' | 'website' | 'custom'

export type QrCode = {
  id: string
  businessId: string
  productId: string | null
  token: string
  label: string
  destination: QrDestination
  customUrl: string | null
  campaign: string | null
  isActive: boolean
  scanCount: number
  lastScanAt: string | null
  createdAt: string
  productName?: string | null
}

/* ── billing ────────────────────────────────────────────────────────────── */

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'cancelled'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'upi' | 'razorpay' | 'other'
export type InvoiceItemKind = 'subscription' | 'setup_fee' | 'model' | 'custom'

export type InvoiceItem = {
  id: string
  invoiceId: string
  description: string
  quantity: number
  unitMinor: number
  amountMinor: number
  kind: InvoiceItemKind
  sortOrder: number
}

export type Payment = {
  id: string
  businessId: string
  invoiceId: string | null
  amountMinor: number
  currency: CurrencyCode
  method: PaymentMethod
  reference: string | null
  proofUrl: string | null
  notes: string | null
  paidAt: string
  recordedBy: string | null
  createdAt: string
}

export type Invoice = {
  id: string
  businessId: string
  subscriptionId: string | null
  number: string
  status: InvoiceStatus
  currency: CurrencyCode
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalMinor: number
  paidMinor: number
  taxName: string | null
  taxPercent: number | null
  issueDate: string
  dueDate: string
  paidAt: string | null
  notes: string | null
  createdAt: string

  businessName?: string
  items?: InvoiceItem[]
  payments?: Payment[]
}

/** Outstanding balance. Never negative — an overpayment is not a debt. */
export function invoiceDueMinor(invoice: Invoice): number {
  return Math.max(0, invoice.totalMinor - invoice.paidMinor)
}

export type Coupon = {
  id: string
  code: string
  description: string | null
  discountType: 'percentage' | 'fixed'
  discountValue: number
  duration: 'once' | 'recurring'
  applicablePlans: string[] | null
  startsAt: string | null
  expiresAt: string | null
  maxRedemptions: number | null
  perBusinessLimit: number
  redemptionCount: number
  isActive: boolean
}

export type Promotion = {
  id: string
  name: string
  description: string | null
  discountType: 'percentage' | 'fixed'
  discountValue: number
  couponCode: string | null
  applicablePlans: string[] | null
  startsAt: string
  endsAt: string
  bannerTitle: string | null
  bannerMessage: string | null
  bannerCtaLabel: string | null
  bannerCtaUrl: string | null
  bannerColor: string | null
  showBanner: boolean
  isActive: boolean
}

/* ── CRM ────────────────────────────────────────────────────────────────── */

export const CRM_STAGES = [
  'new',
  'contacted',
  'demo_scheduled',
  'demo_completed',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
] as const

export type CrmStage = (typeof CRM_STAGES)[number]

export const CRM_STAGE_LABELS: Record<CrmStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  demo_scheduled: 'Demo Scheduled',
  demo_completed: 'Demo Completed',
  proposal_sent: 'Proposal Sent',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
}

export type CrmLead = {
  id: string
  name: string
  businessName: string
  businessType: string | null
  phone: string | null
  email: string | null
  city: string | null
  website: string | null
  instagram: string | null
  source: string | null
  stage: CrmStage
  expectedValueMinor: number
  interestedPlanId: string | null
  assignedTo: string | null
  convertedBusinessId: string | null
  nextFollowUpAt: string | null
  lastContactAt: string | null
  lostReason: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type CrmNote = {
  id: string
  leadId: string
  authorId: string | null
  authorName: string | null
  body: string
  createdAt: string
}

export type CrmTask = {
  id: string
  leadId: string | null
  title: string
  dueAt: string | null
  completedAt: string | null
  assignedTo: string | null
  createdAt: string
  leadName?: string | null
}

export type CrmActivity = {
  id: string
  leadId: string
  actorId: string | null
  actorName: string | null
  action: string
  fromValue: string | null
  toValue: string | null
  createdAt: string
}

/* ── platform ───────────────────────────────────────────────────────────── */

export type Notification = {
  id: string
  businessId: string | null
  userId: string | null
  title: string
  body: string
  kind: 'info' | 'warning' | 'success' | 'billing'
  linkUrl: string | null
  readAt: string | null
  createdAt: string
}

export type AuditLog = {
  id: string
  actorId: string | null
  actorEmail: string | null
  action: string
  entityType: string
  entityId: string | null
  businessId: string | null
  beforeValue: unknown
  afterValue: unknown
  metadata: unknown
  createdAt: string
}

export type SupportTicket = {
  id: string
  businessId: string
  openedBy: string | null
  subject: string
  category: 'technical' | 'billing' | 'feature' | 'other'
  priority: 'low' | 'normal' | 'high'
  status: 'open' | 'pending' | 'closed'
  createdAt: string
  updatedAt: string
  businessName?: string
  messageCount?: number
}

export type TicketMessage = {
  id: string
  ticketId: string
  authorId: string | null
  authorName: string | null
  isStaff: boolean
  body: string
  createdAt: string
}
