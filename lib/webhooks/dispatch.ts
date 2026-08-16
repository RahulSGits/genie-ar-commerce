import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getDb, now, uuid, type Row, str, num, parseJson, toJson, param } from '@/lib/db'
import { isWebhookEvent, type WebhookEvent } from '@/lib/webhooks/events'

/**
 * Outbound webhooks.
 *
 * Two halves on purpose: `emitWebhook` only writes rows, and `deliverPending`
 * does the network I/O. Sending inline from a server action would tie the
 * user's "Publish" click to a third-party server's response time — publish a
 * product, wait eleven seconds for someone's dead Zapier endpoint to time out.
 *
 * Delivery is at-least-once. A receiver must be idempotent on the delivery id,
 * which is documented and sent in the `X-Genie-Delivery` header.
 */

/** Consecutive failures after which an endpoint is switched off. */
const MAX_FAILURES = 10

/** Attempts for a single delivery before it is abandoned. */
const MAX_ATTEMPTS = 5

const TIMEOUT_MS = 10_000

/* ── URL safety ─────────────────────────────────────────────────────────── */

export type UrlCheck = { ok: true } | { ok: false; message: string }

/**
 * Rejects webhook targets that point back inside our own network.
 *
 * Without this, a customer can register `http://169.254.169.254/...` and use
 * GENIE's own servers to read cloud instance metadata, or probe private
 * services that are only reachable from inside the VPC. This is server-side
 * request forgery, and a webhook feature is the classic way in.
 *
 * DNS can still resolve a public name to a private address (a rebinding
 * attack), which this cannot catch — the deployment note in docs/security.md
 * covers running deliveries through an egress proxy for that.
 */
export function checkWebhookUrl(raw: string): UrlCheck {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, message: 'Not a valid URL.' }
  }

  if (url.protocol !== 'https:') {
    // Payloads carry product and analytics data; plaintext http would leak it
    // and expose the signature to replay.
    return { ok: false, message: 'Webhook URLs must use https.' }
  }

  const host = url.hostname.toLowerCase()

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, message: 'That host is not reachable from the internet.' }
  }

  // Literal private and link-local ranges.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    const isPrivate =
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    if (isPrivate) return { ok: false, message: 'Private network addresses are not allowed.' }
  }

  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return { ok: false, message: 'Private network addresses are not allowed.' }
  }

  return { ok: true }
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`
}

/* ── signing ────────────────────────────────────────────────────────────── */

/**
 * Signature over `<timestamp>.<body>`, not over the body alone.
 *
 * Signing the body by itself produces a signature that stays valid forever, so
 * anyone who captures one request can replay it indefinitely. Binding the
 * timestamp into the signed string lets a receiver reject anything older than
 * its tolerance window.
 */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${mac}`
}

/** Reference verifier — also what the docs page shows customers. */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, v] = p.split('=')
      return [k?.trim() ?? '', v?.trim() ?? '']
    }),
  )
  const timestamp = Number(parts['t'])
  const given = parts['v1']
  if (!Number.isFinite(timestamp) || !given) return false

  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(given, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ── emit ───────────────────────────────────────────────────────────────── */

/**
 * Queues a delivery for every active endpoint subscribed to `event`.
 *
 * Never throws. A webhook is an accessory to the action that triggered it, so
 * a failure here must not roll back the product that was just published.
 */
export function emitWebhook(businessId: string, event: WebhookEvent, data: unknown): void {
  try {
    const db = getDb()
    const endpoints = db
      .prepare(`SELECT id, events FROM webhook_endpoints WHERE business_id = ? AND is_active = 1`)
      .all(businessId) as Row[]

    if (endpoints.length === 0) return

    const timestamp = now()
    const payload =
      toJson({ id: `evt_${uuid()}`, event, createdAt: timestamp, businessId, data }) ?? '{}'

    for (const endpoint of endpoints) {
      const subscribed = parseJson<string[]>(endpoint['events'], [])
      if (!subscribed.includes('*') && !subscribed.includes(event)) continue

      db.prepare(
        `INSERT INTO webhook_deliveries
           (id, endpoint_id, business_id, event, payload, status, next_retry_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(uuid(), str(endpoint, 'id'), businessId, event, payload, timestamp, timestamp)
    }
  } catch {
    // Deliberately swallowed — see the doc comment.
  }
}

/* ── deliver ────────────────────────────────────────────────────────────── */

export type DeliveryOutcome = { attempted: number; delivered: number; failed: number }

/**
 * Sends everything that is due.
 *
 * Called opportunistically from the dashboard and from the cron route, the
 * same pattern the billing engine uses — no separate worker process to deploy,
 * and no queue service to pay for at this size.
 */
export async function deliverPending(limit = 25): Promise<DeliveryOutcome> {
  const db = getDb()
  const timestamp = now()

  const due = db
    .prepare(
      `SELECT d.*, e.url, e.secret, e.failure_count
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE d.status = 'pending'
          AND e.is_active = 1
          AND (d.next_retry_at IS NULL OR d.next_retry_at <= ?)
        ORDER BY d.created_at ASC
        LIMIT ?`,
    )
    .all(timestamp, limit) as Row[]

  const outcome: DeliveryOutcome = { attempted: 0, delivered: 0, failed: 0 }

  for (const row of due) {
    outcome.attempted += 1
    const id = str(row, 'id')
    const attempts = num(row, 'attempts') + 1
    const body = str(row, 'payload')
    const seconds = Math.floor(Date.now() / 1000)

    let responseStatus: number | null = null
    let error: string | null = null

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const response = await fetch(str(row, 'url'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'GENIE-Webhooks/1.0',
            'X-Genie-Event': str(row, 'event'),
            'X-Genie-Delivery': id,
            'X-Genie-Signature': signPayload(str(row, 'secret'), body, seconds),
          },
          body,
          signal: controller.signal,
          redirect: 'error',
        })
        responseStatus = response.status
        if (!response.ok) error = `HTTP ${response.status}`
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Request failed'
    }

    if (!error) {
      db.prepare(
        `UPDATE webhook_deliveries
            SET status = 'delivered', attempts = ?, response_status = ?, delivered_at = ?, error = NULL
          WHERE id = ?`,
      ).run(attempts, param(responseStatus), now(), id)

      db.prepare(
        `UPDATE webhook_endpoints SET failure_count = 0, last_error = NULL, last_success_at = ? WHERE id = ?`,
      ).run(now(), str(row, 'endpoint_id'))

      outcome.delivered += 1
      continue
    }

    outcome.failed += 1
    const exhausted = attempts >= MAX_ATTEMPTS

    db.prepare(
      `UPDATE webhook_deliveries
          SET status = ?, attempts = ?, response_status = ?, error = ?, next_retry_at = ?
        WHERE id = ?`,
    ).run(
      exhausted ? 'failed' : 'pending',
      attempts,
      param(responseStatus),
      error.slice(0, 500),
      exhausted ? null : backoffFrom(attempts),
      id,
    )

    const failureCount = num(row, 'failure_count') + 1
    db.prepare(
      `UPDATE webhook_endpoints
          SET failure_count = ?, last_error = ?, is_active = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      failureCount,
      error.slice(0, 500),
      failureCount >= MAX_FAILURES ? 0 : 1,
      now(),
      str(row, 'endpoint_id'),
    )
  }

  return outcome
}

/** Exponential backoff: 1m, 4m, 16m, 64m — capped, and pure so it is testable. */
export function backoffFrom(attempt: number, at: Date = new Date()): string {
  const minutes = Math.min(60 * 4, 4 ** (attempt - 1))
  return new Date(at.getTime() + minutes * 60_000).toISOString()
}

/* ── management ─────────────────────────────────────────────────────────── */

export type WebhookEndpoint = {
  id: string
  businessId: string
  url: string
  secret: string
  events: string[]
  isActive: boolean
  failureCount: number
  lastError: string | null
  lastSuccessAt: string | null
  createdAt: string
}

export function listEndpoints(businessId: string): WebhookEndpoint[] {
  const rows = getDb()
    .prepare(`SELECT * FROM webhook_endpoints WHERE business_id = ? ORDER BY created_at DESC`)
    .all(businessId) as Row[]
  return rows.map((row) => ({
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    url: str(row, 'url'),
    secret: str(row, 'secret'),
    events: parseJson<string[]>(row['events'], []),
    isActive: row['is_active'] === 1,
    failureCount: num(row, 'failure_count'),
    lastError: typeof row['last_error'] === 'string' ? row['last_error'] : null,
    lastSuccessAt: typeof row['last_success_at'] === 'string' ? row['last_success_at'] : null,
    createdAt: str(row, 'created_at'),
  }))
}

export type DeliveryRecord = {
  id: string
  event: string
  status: string
  attempts: number
  responseStatus: number | null
  error: string | null
  createdAt: string
}

export function listDeliveries(businessId: string, limit = 20): DeliveryRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, event, status, attempts, response_status, error, created_at
         FROM webhook_deliveries WHERE business_id = ?
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(businessId, limit) as Row[]
  return rows.map((row) => ({
    id: str(row, 'id'),
    event: str(row, 'event'),
    status: str(row, 'status'),
    attempts: num(row, 'attempts'),
    responseStatus: typeof row['response_status'] === 'number' ? row['response_status'] : null,
    error: typeof row['error'] === 'string' ? row['error'] : null,
    createdAt: str(row, 'created_at'),
  }))
}

export function createEndpoint(input: {
  businessId: string
  url: string
  events: string[]
}): WebhookEndpoint {
  const id = uuid()
  const secret = newWebhookSecret()
  const timestamp = now()
  const events = input.events.filter((e) => e === '*' || isWebhookEvent(e))

  getDb()
    .prepare(
      `INSERT INTO webhook_endpoints (id, business_id, url, secret, events, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.businessId, input.url, secret, toJson(events) ?? '[]', timestamp, timestamp)

  return {
    id,
    businessId: input.businessId,
    url: input.url,
    secret,
    events,
    isActive: true,
    failureCount: 0,
    lastError: null,
    lastSuccessAt: null,
    createdAt: timestamp,
  }
}

export function deleteEndpoint(businessId: string, id: string): void {
  getDb().prepare(`DELETE FROM webhook_endpoints WHERE id = ? AND business_id = ?`).run(id, businessId)
}

export function setEndpointActive(businessId: string, id: string, active: boolean): void {
  getDb()
    .prepare(
      `UPDATE webhook_endpoints SET is_active = ?, failure_count = 0, updated_at = ?
        WHERE id = ? AND business_id = ?`,
    )
    .run(active ? 1 : 0, now(), id, businessId)
}
