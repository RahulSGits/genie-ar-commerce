'use client'

import { useActionState, useState, useTransition } from 'react'
import Link from 'next/link'
import { Copy, KeyRound, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import {
  Alert, Badge, Button, Card, Field, Input, Table, TBody, TD, TH, THead, TR,
} from '@/components/ui'
import {
  createApiKeyAction,
  revokeApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  toggleWebhookAction,
  flushWebhooksAction,
} from '@/lib/actions/developer'
import { API_SCOPES, SCOPE_LABELS, type ApiKey } from '@/lib/api/scopes'
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS, HIGH_VOLUME_EVENTS } from '@/lib/webhooks/events'

type Endpoint = {
  id: string
  url: string
  secret: string
  events: string[]
  isActive: boolean
  failureCount: number
  lastError: string | null
  lastSuccessAt: string | null
}

type Delivery = {
  id: string
  event: string
  status: string
  attempts: number
  responseStatus: number | null
  error: string | null
  createdAt: string
}

/**
 * API keys and webhooks (§43, §44).
 *
 * A created secret is shown exactly once, in a panel the user must dismiss.
 * There is no "reveal" button anywhere, because the server keeps only a hash —
 * a reveal button would require storing the plaintext, which is the thing the
 * hash exists to avoid.
 */
export default function DeveloperConsole({
  keys,
  endpoints,
  deliveries,
  planAllows,
  planName,
  apiEnabled,
  webhooksEnabled,
}: {
  keys: ApiKey[]
  endpoints: Endpoint[]
  deliveries: Delivery[]
  planAllows: boolean
  planName: string
  apiEnabled: boolean
  webhooksEnabled: boolean
}) {
  const [keyState, keyAction, keySubmitting] = useActionState(createApiKeyAction, null)
  const [hookState, hookAction, hookSubmitting] = useActionState(createWebhookAction, null)
  const [pending, startTransition] = useTransition()
  const [showKeyForm, setShowKeyForm] = useState(false)

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${what} copied.`)
    } catch {
      toast.error('Could not copy — select the text and copy it manually.')
    }
  }

  const revoke = (id: string, name: string) => {
    if (!confirm(`Revoke “${name}”? Any integration using it stops working immediately.`)) return
    startTransition(async () => {
      const result = await revokeApiKeyAction(id)
      toast[result.ok ? 'success' : 'error'](result.ok ? 'Key revoked.' : result.error)
    })
  }

  const flush = () => {
    startTransition(async () => {
      const result = await flushWebhooksAction()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const { attempted, delivered, failed } = result.data
      toast[failed > 0 ? 'warning' : 'success'](
        attempted === 0
          ? 'Nothing queued to send.'
          : `${delivered} delivered, ${failed} failed of ${attempted}.`,
      )
    })
  }

  return (
    <div className="space-y-8">
      {!planAllows && (
        <Alert variant="warning">
          The API is not part of the <strong>{planName}</strong> plan. Keys created here will
          authenticate but every request is refused with <code>402</code> until the plan includes
          API access.{' '}
          <Link href="/dashboard/billing" className="underline">
            See plans
          </Link>
        </Alert>
      )}
      {planAllows && !apiEnabled && (
        <Alert variant="warning">
          The public API is switched off for this deployment. An administrator can enable it under
          platform settings.
        </Alert>
      )}

      {/* ── API keys ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="size-4" aria-hidden />
              API keys
            </h2>
            <p className="text-muted-foreground text-xs">
              Base URL <code className="bg-muted rounded px-1">/api/v1</code>. See the{' '}
              <Link href="/docs/api" className="underline">
                API reference
              </Link>
              .
            </p>
          </div>
          <Button size="sm" onClick={() => setShowKeyForm((open) => !open)}>
            New key
          </Button>
        </div>

        {keyState?.ok && (
          <Alert variant="success">
            <p className="font-medium">Copy this key now — it will not be shown again.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="bg-background min-w-0 flex-1 truncate rounded border px-2 py-1.5 font-mono text-xs">
                {keyState.data.token}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copy(keyState.data.token, 'API key')}
              >
                <Copy className="size-3.5" aria-hidden />
                Copy
              </Button>
            </div>
            <p className="mt-2 text-xs">
              GENIE stores only a SHA-256 hash of this value, so it cannot be recovered — not by
              you, and not by support.
            </p>
          </Alert>
        )}

        {showKeyForm && (
          <Card className="p-5">
            <form action={keyAction} className="space-y-4">
              <Field label="Name" htmlFor="key-name" hint="How you'll recognise it in this list.">
                <Input id="key-name" name="name" required placeholder="Shopify sync" />
              </Field>

              <fieldset>
                <legend className="text-sm font-medium">Scopes</legend>
                <p className="text-muted-foreground mb-2 text-xs">
                  Grant only what the integration needs. A key without a scope gets 403, not a
                  silent partial result.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {API_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="scopes"
                        value={scope}
                        className="mt-0.5"
                        defaultChecked={scope === 'products:read'}
                      />
                      <span>
                        <code className="text-xs">{scope}</code>
                        <span className="text-muted-foreground block text-xs">
                          {SCOPE_LABELS[scope]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {keyState?.ok === false && (
                <p className="text-destructive text-sm" role="alert">
                  {keyState.error}
                </p>
              )}

              <Button type="submit" disabled={keySubmitting}>
                {keySubmitting ? 'Creating…' : 'Create key'}
              </Button>
            </form>
          </Card>
        )}

        {keys.length > 0 && (
          <Card className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Key</TH>
                  <TH>Scopes</TH>
                  <TH>Requests</TH>
                  <TH>Last used</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {keys.map((key) => (
                  <TR key={key.id} className={key.revokedAt ? 'opacity-50' : undefined}>
                    <TD className="font-medium">{key.name}</TD>
                    <TD>
                      <code className="text-xs">{key.prefix}…</code>
                    </TD>
                    <TD className="text-xs">{key.scopes.length}</TD>
                    <TD className="tabular-nums">{key.requestCount.toLocaleString()}</TD>
                    <TD className="text-muted-foreground text-xs">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                    </TD>
                    <TD className="text-right">
                      {key.revokedAt ? (
                        <Badge variant="muted">Revoked</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={pending}
                          onClick={() => revoke(key.id, key.name)}
                        >
                          Revoke
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </section>

      {/* ── Webhooks ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Webhook className="size-4" aria-hidden />
              Webhooks
            </h2>
            <p className="text-muted-foreground text-xs">
              Signed with HMAC-SHA256 over <code>timestamp.body</code>, retried with backoff.
            </p>
          </div>
          <Button size="sm" variant="secondary" disabled={pending} onClick={flush}>
            Send queued now
          </Button>
        </div>

        {!webhooksEnabled && (
          <Alert variant="warning">
            Webhook delivery is switched off for this deployment, so nothing will be sent. An
            administrator can enable it under platform settings.
          </Alert>
        )}

        {hookState?.ok && (
          <Alert variant="success">
            <p className="font-medium">Signing secret — shown once.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="bg-background min-w-0 flex-1 truncate rounded border px-2 py-1.5 font-mono text-xs">
                {hookState.data.secret}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copy(hookState.data.secret, 'Signing secret')}
              >
                <Copy className="size-3.5" aria-hidden />
                Copy
              </Button>
            </div>
          </Alert>
        )}

        <Card className="p-5">
          <form action={hookAction} className="space-y-4">
            <Field
              label="Endpoint URL"
              htmlFor="hook-url"
              hint="Must be https and publicly reachable. Private and loopback addresses are refused."
            >
              <Input
                id="hook-url"
                name="url"
                type="url"
                required
                placeholder="https://example.com/hooks/genie"
                disabled={!webhooksEnabled}
              />
            </Field>

            <fieldset>
              <legend className="text-sm font-medium">Events</legend>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {WEBHOOK_EVENTS.map((event) => (
                  <label key={event} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="events"
                      value={event}
                      className="mt-0.5"
                      disabled={!webhooksEnabled}
                    />
                    <span>
                      <code className="text-xs">{event}</code>
                      <span className="text-muted-foreground block text-xs">
                        {WEBHOOK_EVENT_LABELS[event]}
                        {HIGH_VOLUME_EVENTS.has(event) && ' — high volume'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {hookState?.ok === false && (
              <p className="text-destructive text-sm" role="alert">
                {hookState.error}
              </p>
            )}

            <Button type="submit" disabled={hookSubmitting || !webhooksEnabled}>
              {hookSubmitting ? 'Adding…' : 'Add endpoint'}
            </Button>
          </form>
        </Card>

        {endpoints.map((endpoint) => (
          <Card key={endpoint.id} className="space-y-2 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="min-w-0 truncate text-sm">{endpoint.url}</code>
              <div className="flex items-center gap-2">
                <Badge variant={endpoint.isActive ? 'success' : 'muted'}>
                  {endpoint.isActive ? 'Active' : 'Disabled'}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await toggleWebhookAction(endpoint.id, !endpoint.isActive)
                    })
                  }
                >
                  {endpoint.isActive ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await deleteWebhookAction(endpoint.id)
                    })
                  }
                >
                  Delete
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              {endpoint.events.join(', ') || 'No events selected'}
            </p>
            {endpoint.failureCount > 0 && (
              <p className="text-destructive text-xs">
                {endpoint.failureCount} consecutive failure
                {endpoint.failureCount === 1 ? '' : 's'}
                {endpoint.lastError ? ` — ${endpoint.lastError}` : ''}
                {endpoint.failureCount >= 10 && ' · disabled automatically'}
              </p>
            )}
          </Card>
        ))}

        {deliveries.length > 0 && (
          <Card className="p-0">
            <p className="border-b px-5 py-3 text-sm font-semibold">Recent deliveries</p>
            <Table>
              <THead>
                <TR>
                  <TH>Event</TH>
                  <TH>Status</TH>
                  <TH>Attempts</TH>
                  <TH>Response</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {deliveries.map((delivery) => (
                  <TR key={delivery.id}>
                    <TD>
                      <code className="text-xs">{delivery.event}</code>
                    </TD>
                    <TD>
                      <Badge
                        variant={
                          delivery.status === 'delivered'
                            ? 'success'
                            : delivery.status === 'failed'
                              ? 'destructive'
                              : 'muted'
                        }
                      >
                        {delivery.status}
                      </Badge>
                    </TD>
                    <TD className="tabular-nums">{delivery.attempts}</TD>
                    <TD className="text-xs">
                      {delivery.responseStatus ?? delivery.error ?? '—'}
                    </TD>
                    <TD className="text-muted-foreground text-xs">
                      {new Date(delivery.createdAt).toLocaleString()}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </section>
    </div>
  )
}
