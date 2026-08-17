/**
 * Campaign shape and status logic — the client-safe half.
 *
 * Deliberately NOT `server-only`. The campaign list and detail screens are
 * client components and need the type, the labels and the status function;
 * importing them from lib/db/repositories/campaigns.ts drags the database into
 * the browser bundle and fails the build. TypeScript cannot see that — only the
 * bundler can — so the split is the guard.
 *
 * Same reasoning as lib/api/scopes.ts and lib/webhooks/events.ts.
 */

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired'

export type Campaign = {
  id: string
  businessId: string
  name: string
  slug: string
  description: string | null
  coverUrl: string | null
  destination: 'landing' | 'product'
  productId: string | null
  /** The operator's stored intent: draft | live | paused. */
  storedStatus: string
  /** What is actually true right now, given the dates. */
  status: CampaignStatus
  startsAt: string | null
  endsAt: string | null
  goal: string | null
  productCount: number
  qrCount: number
  scans: number
  createdAt: string
  updatedAt: string
}

/**
 * Derives the real status from the stored intent plus the dates.
 *
 * The stored column is the operator's *intent*; whether a campaign is live is a
 * function of intent AND the clock. Storing "active" and relying on a job to
 * flip it to "expired" means a campaign whose end date passed while the job was
 * down is still advertising a finished promotion.
 *
 * Pure, so it is unit-testable without a database and correct on both sides of
 * the network boundary.
 */
export function resolveCampaignStatus(
  stored: string,
  startsAt: string | null,
  endsAt: string | null,
  at: string = new Date().toISOString(),
): CampaignStatus {
  if (stored === 'draft') return 'draft'
  if (stored === 'paused') return 'paused'
  if (endsAt && endsAt <= at) return 'expired'
  if (startsAt && startsAt > at) return 'scheduled'
  return 'active'
}

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  active: 'Active',
  paused: 'Paused',
  expired: 'Ended',
}

export const CAMPAIGN_STATUS_VARIANTS: Record<
  CampaignStatus,
  'default' | 'success' | 'warning' | 'muted' | 'destructive'
> = {
  draft: 'muted',
  scheduled: 'default',
  active: 'success',
  paused: 'warning',
  expired: 'muted',
}
