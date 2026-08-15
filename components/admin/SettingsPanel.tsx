'use client'

import { useActionState, useState, useTransition } from 'react'
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Separator, Switch } from '@/components/ui'
import { saveFeatureFlagsAction, saveTaxSettingsAction } from '@/lib/actions/admin'
import type { ActionResult } from '@/lib/auth/errors'

type TaxSettings = { enabled: boolean; name: string; percent: number; taxId: string }
type BillingSettings = { gracePeriodDays: number; autoSuspend: boolean; invoicePrefix: string }

type FlagMeta = { label: string; description: string; paid?: boolean }

/**
 * Flags marked `paid` switch on code paths that call a third party we have to
 * pay for. They are listed so an operator can see the whole surface, but they
 * do nothing until credentials exist — turning one on never starts a bill.
 */
const FLAG_META: Record<string, FlagMeta> = {
  model_generation: {
    label: 'AI 3D model generation',
    description: 'Turns product photos into a GLB through an external generation service.',
    paid: true,
  },
  payments: {
    label: 'Online payments',
    description: 'Lets clients pay invoices by card or UPI through a payment gateway.',
    paid: true,
  },
  whatsapp: {
    label: 'WhatsApp messages',
    description: 'Sends invoice and follow-up messages over the WhatsApp Business API.',
    paid: true,
  },
  voice_calling: {
    label: 'Voice calling',
    description: 'Places reminder calls through a telephony provider.',
    paid: true,
  },
  marker_ar: {
    label: 'Marker AR fallback',
    description: 'Printed-marker AR for phones without WebXR or Quick Look.',
  },
  white_label: {
    label: 'White label',
    description: 'Hides platform branding on client AR pages.',
  },
  custom_domain: {
    label: 'Custom domains',
    description: 'Lets a client serve their AR pages from their own domain.',
  },
  advanced_analytics: {
    label: 'Advanced analytics',
    description: 'Funnel, device and per-product breakdowns inside client dashboards.',
  },
  pwa: {
    label: 'Installable app',
    description: 'Offers the dashboard as an installable progressive web app.',
  },
}

export default function SettingsPanel({
  flags,
  tax,
  billing,
}: {
  flags: Record<string, boolean>
  tax: TaxSettings
  billing: BillingSettings
}) {
  return (
    <div className="space-y-4">
      <FeatureFlags initial={flags} />
      <TaxForm tax={tax} />
      <BillingCard billing={billing} />
    </div>
  )
}

/* ── feature flags ──────────────────────────────────────────────────────── */

function FeatureFlags({ initial }: { initial: Record<string, boolean> }) {
  const [flags, setFlags] = useState(initial)
  const [pending, startTransition] = useTransition()

  // Known flags first, in a deliberate order; anything else the DB holds still shows.
  const keys = [
    ...Object.keys(FLAG_META).filter((key) => key in flags),
    ...Object.keys(flags).filter((key) => !(key in FLAG_META)),
  ]

  function toggle(key: string, value: boolean) {
    const next = { ...flags, [key]: value }
    setFlags(next)
    startTransition(() => {
      void saveFeatureFlagsAction(next)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Feature flags</CardTitle>
        <CardDescription>
          Switches for the whole platform. Anything marked as a paid integration stays inert until
          its credentials are configured, so it is safe to leave off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {keys.map((key) => {
          const meta = FLAG_META[key]
          const checked = flags[key] ?? false
          return (
            <div key={key} className="flex items-start gap-3 border-b py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`flag-${key}`} className="text-sm font-medium">
                    {meta?.label ?? key}
                  </label>
                  {meta?.paid && <Badge variant="warning">Optional paid integration</Badge>}
                </div>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {meta?.description ?? 'Custom flag read by application code.'}
                </p>
                {meta?.paid && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Needs a third-party account and API credentials. Without them the feature is
                    hidden rather than broken.
                  </p>
                )}
              </div>
              <Switch
                id={`flag-${key}`}
                checked={checked}
                disabled={pending}
                onCheckedChange={(value) => toggle(key, value)}
              />
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

/* ── tax ────────────────────────────────────────────────────────────────── */

function TaxForm({ tax }: { tax: TaxSettings }) {
  const [state, action, pending] = useActionState<ActionResult<null> | null, FormData>(
    saveTaxSettingsAction,
    null,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tax</CardTitle>
        <CardDescription>
          Applied to new invoices. Existing invoices keep the rate they were raised with.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
          {state?.ok && <Alert variant="success">Tax settings saved.</Alert>}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={tax.enabled}
              className="border-input accent-primary size-4 rounded border"
            />
            Add tax to invoices
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Tax name" htmlFor="tax-name" hint="Printed on the invoice line.">
              <Input id="tax-name" name="name" defaultValue={tax.name} placeholder="GST" />
            </Field>

            <Field label="Rate (%)" htmlFor="tax-percent">
              <Input
                id="tax-percent"
                name="percent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={tax.percent}
              />
            </Field>

            <Field label="Tax ID" htmlFor="tax-id" hint="Your GSTIN or equivalent.">
              <Input id="tax-id" name="taxId" defaultValue={tax.taxId} />
            </Field>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save tax settings'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/* ── billing (read-only) ────────────────────────────────────────────────── */

function BillingCard({ billing }: { billing: BillingSettings }) {
  const rows: Array<[string, string]> = [
    ['Grace period', `${billing.gracePeriodDays} days after the due date`],
    ['Auto-suspend', billing.autoSuspend ? 'On' : 'Off'],
    ['Invoice prefix', billing.invoicePrefix],
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Billing defaults</CardTitle>
        <CardDescription>
          Read-only here. These are set in configuration because changing them mid-cycle would
          re-date invoices that have already been sent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Separator className="mb-3" />
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 border-b py-1.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
