'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/guards'
import { guarded, badRequest, type ActionResult } from '@/lib/auth/errors'
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  setCampaignProducts,
  campaignSlugAvailable,
} from '@/lib/db/repositories/campaigns'
import { createQrCode } from '@/lib/db/repositories/qr'
import { getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { canCreateQrCode } from '@/lib/billing/entitlements'
import { emitWebhook } from '@/lib/webhooks/dispatch'
import { slugify } from '@/lib/utils'

/**
 * Campaign management (§21, §31).
 *
 * Every mutation goes through `campaigns:write`; reads through `campaigns:read`.
 * An Analyst can see how the Diwali campaign performed and cannot change when
 * it ends.
 */

const campaignSchema = z.object({
  name: z.string().trim().min(2, 'Give the campaign a name.').max(120),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  startsAt: z.string().trim().optional().or(z.literal('')),
  endsAt: z.string().trim().optional().or(z.literal('')),
  goal: z.string().trim().max(120).optional().or(z.literal('')),
})

/** `datetime-local` gives "2026-08-20T18:00" with no zone; store as ISO UTC. */
function toIso(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function createCampaignAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const ctx = await requirePermission('campaigns:write')

    const parsed = campaignSchema.safeParse(Object.fromEntries(formData))
    if (!parsed.success) {
      badRequest(parsed.error.issues[0]?.message ?? 'Check the campaign details.')
    }

    const { name, description, startsAt, endsAt, goal } = parsed.data
    const from = toIso(startsAt)
    const to = toIso(endsAt)

    // A window that closes before it opens would render as permanently
    // "expired" with no way to tell why from the UI.
    if (from && to && to <= from) {
      badRequest('The end date must be after the start date.')
    }

    const base = slugify(name)
    let slug = base
    let suffix = 2
    while (!campaignSlugAvailable(ctx.businessId, slug)) slug = `${base}-${suffix++}`

    const id = createCampaign({
      businessId: ctx.businessId,
      name,
      slug,
      description: description || null,
      startsAt: from,
      endsAt: to,
      goal: goal || null,
    })

    revalidatePath('/dashboard/campaigns')
    return { id }
  })
}

export async function updateCampaignAction(
  campaignId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('campaigns:write')

    if ('startsAt' in patch || 'endsAt' in patch) {
      const existing = getCampaign(ctx.businessId, campaignId)
      const from = 'startsAt' in patch ? toIso(String(patch.startsAt ?? '')) : (existing?.startsAt ?? null)
      const to = 'endsAt' in patch ? toIso(String(patch.endsAt ?? '')) : (existing?.endsAt ?? null)
      if (from && to && to <= from) badRequest('The end date must be after the start date.')
      if ('startsAt' in patch) patch.startsAt = from
      if ('endsAt' in patch) patch.endsAt = to
    }

    updateCampaign(ctx.businessId, campaignId, patch)

    if (patch.status === 'live') {
      const campaign = getCampaign(ctx.businessId, campaignId)
      if (campaign?.status === 'active') {
        emitWebhook(ctx.businessId, 'campaign.published', {
          campaignId,
          name: campaign.name,
          slug: campaign.slug,
        })
      }
    }

    revalidatePath('/dashboard/campaigns')
    revalidatePath(`/dashboard/campaigns/${campaignId}`)
    return null
  })
}

export async function setCampaignProductsAction(
  campaignId: string,
  productIds: string[],
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('campaigns:write')
    setCampaignProducts(ctx.businessId, campaignId, productIds)
    revalidatePath(`/dashboard/campaigns/${campaignId}`)
    return null
  })
}

export async function deleteCampaignAction(campaignId: string): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('campaigns:write')
    deleteCampaign(ctx.businessId, campaignId)
    revalidatePath('/dashboard/campaigns')
    return null
  })
}

/**
 * Mints a QR code that points at the campaign's landing page.
 *
 * The code is bound to the campaign rather than to a product, so re-pointing
 * the campaign at next season's dishes leaves every printed table tent working.
 */
export async function createCampaignQrAction(
  campaignId: string,
  label: string,
): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const ctx = await requirePermission('campaigns:write')

    const campaign = getCampaign(ctx.businessId, campaignId)
    if (!campaign) badRequest('That campaign no longer exists.')

    const allowed = canCreateQrCode(getEntitlements(ctx.businessId), getUsage(ctx.businessId))
    if (!allowed.allowed) badRequest(allowed.message)

    const { id } = createQrCode({
      businessId: ctx.businessId,
      label: label.trim() || campaign.name,
      destination: 'custom',
      customUrl: `/c/${ctx.businessSlug}/${campaign.slug}`,
      campaign: campaign.name,
      campaignId,
    })

    revalidatePath(`/dashboard/campaigns/${campaignId}`)
    return { id }
  })
}

export async function listCampaignsAction() {
  const ctx = await requirePermission('campaigns:read')
  return listCampaigns(ctx.businessId)
}
