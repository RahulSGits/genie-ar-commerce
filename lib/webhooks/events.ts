/**
 * Webhook event catalogue.
 *
 * Kept free of `server-only` so the dashboard can render the subscription
 * checkboxes from the same list the dispatcher validates against — two lists
 * would drift, and a business would subscribe to an event that never fires.
 */

export const WEBHOOK_EVENTS = [
  'product.created',
  'product.updated',
  'product.published',
  'product.unpublished',
  'generation.started',
  'generation.completed',
  'generation.failed',
  'qr.scanned',
  'ar.started',
  'campaign.published',
  'campaign.expired',
  'subscription.updated',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'product.created': 'A product was created',
  'product.updated': 'A product was changed',
  'product.published': 'A product went live',
  'product.unpublished': 'A product was taken down',
  'generation.started': '3D generation began',
  'generation.completed': 'A 3D model is ready',
  'generation.failed': '3D generation failed',
  'qr.scanned': 'A QR code was scanned',
  'ar.started': 'A customer opened AR',
  'campaign.published': 'A campaign went live',
  'campaign.expired': 'A campaign ended',
  'subscription.updated': 'Subscription or plan changed',
}

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value)
}

/**
 * `qr.scanned` and `ar.started` fire on public customer traffic, so a busy
 * restaurant generates thousands a day. They are opt-in and flagged here so
 * the UI can warn before someone points them at a spreadsheet automation.
 */
export const HIGH_VOLUME_EVENTS: ReadonlySet<WebhookEvent> = new Set<WebhookEvent>([
  'qr.scanned',
  'ar.started',
])
