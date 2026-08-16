'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/guards'
import { guarded, badRequest, type ActionResult } from '@/lib/auth/errors'
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  API_SCOPES,
  type ApiScope,
} from '@/lib/api/keys'
import {
  createEndpoint,
  deleteEndpoint,
  setEndpointActive,
  listEndpoints,
  listDeliveries,
  checkWebhookUrl,
  deliverPending,
} from '@/lib/webhooks/dispatch'
import { getEntitlements } from '@/lib/db/repositories/businesses'
import { isFeatureEnabled } from '@/lib/db/repositories/platform'
import { recordAudit } from '@/lib/db/repositories/platform'

/**
 * API keys and webhooks (§43, §44).
 *
 * Both are gated on the plan's `api_access` feature AND on the deployment's
 * own flag. The plan decides whether a customer bought it; the flag decides
 * whether this deployment offers it at all — an operator who has not thought
 * about outbound egress should not have webhooks firing.
 */

export async function developerOverviewAction() {
  const ctx = await requirePermission('api:manage')
  const entitlements = getEntitlements(ctx.businessId)

  return {
    keys: listApiKeys(ctx.businessId),
    endpoints: listEndpoints(ctx.businessId).map((endpoint) => ({
      ...endpoint,
      // The signing secret is deliberately not sent to the client list. It is
      // shown once, at creation, in the response of createWebhookAction.
      secret: `${endpoint.secret.slice(0, 11)}…`,
    })),
    deliveries: listDeliveries(ctx.businessId),
    planAllows: entitlements.features.api_access,
    planName: entitlements.planName,
    apiEnabled: isFeatureEnabled('public_api'),
    webhooksEnabled: isFeatureEnabled('webhooks'),
  }
}

export async function createApiKeyAction(
  _prev: ActionResult<{ token: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ token: string }>> {
  return guarded(async () => {
    const ctx = await requirePermission('api:manage')

    const entitlements = getEntitlements(ctx.businessId)
    if (!entitlements.features.api_access) {
      badRequest(`API access is not included in the ${entitlements.planName} plan.`)
    }

    const name = String(formData.get('name') ?? '').trim()
    if (name.length < 2) badRequest('Give the key a name so you can recognise it later.')

    const scopes = formData
      .getAll('scopes')
      .map(String)
      .filter((s): s is ApiScope => (API_SCOPES as string[]).includes(s))

    if (scopes.length === 0) badRequest('Select at least one scope.')

    const { key, token } = createApiKey({
      businessId: ctx.businessId,
      name,
      scopes,
      createdBy: ctx.user.id,
    })

    recordAudit({
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: key.id,
      businessId: ctx.businessId,
      // The token itself is never audited — an audit log is not a place to
      // store a live credential.
      after: { name, scopes, prefix: key.prefix },
    })

    revalidatePath('/dashboard/developers')
    return { token }
  })
}

export async function revokeApiKeyAction(keyId: string): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('api:manage')
    revokeApiKey(ctx.businessId, keyId)

    recordAudit({
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: keyId,
      businessId: ctx.businessId,
    })

    revalidatePath('/dashboard/developers')
    return null
  })
}

export async function createWebhookAction(
  _prev: ActionResult<{ secret: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ secret: string }>> {
  return guarded(async () => {
    const ctx = await requirePermission('api:manage')

    if (!isFeatureEnabled('webhooks')) {
      badRequest('Webhook delivery is switched off on this deployment.')
    }

    const url = String(formData.get('url') ?? '').trim()
    const check = checkWebhookUrl(url)
    if (!check.ok) badRequest(check.message)

    const events = formData.getAll('events').map(String)
    if (events.length === 0) badRequest('Choose at least one event to send.')

    const endpoint = createEndpoint({ businessId: ctx.businessId, url, events })

    revalidatePath('/dashboard/developers')
    return { secret: endpoint.secret }
  })
}

export async function deleteWebhookAction(id: string): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('api:manage')
    deleteEndpoint(ctx.businessId, id)
    revalidatePath('/dashboard/developers')
    return null
  })
}

export async function toggleWebhookAction(id: string, active: boolean): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('api:manage')
    setEndpointActive(ctx.businessId, id, active)
    revalidatePath('/dashboard/developers')
    return null
  })
}

/**
 * Sends whatever is queued, right now.
 *
 * Delivery is otherwise opportunistic (dashboard loads and the cron route), so
 * this exists to make "did my endpoint work?" answerable without waiting — the
 * result reports what actually happened rather than claiming success.
 */
export async function flushWebhooksAction(): Promise<
  ActionResult<{ attempted: number; delivered: number; failed: number }>
> {
  return guarded(async () => {
    await requirePermission('api:manage')
    const outcome = await deliverPending()
    revalidatePath('/dashboard/developers')
    return outcome
  })
}
