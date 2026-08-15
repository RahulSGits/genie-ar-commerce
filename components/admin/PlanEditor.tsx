'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, Button, Field, Input, Label, Select, Textarea } from '@/components/ui'
import { savePlanAction } from '@/lib/actions/admin'
import { minorToMajor } from '@/utils/money'
import type { ActionResult } from '@/lib/auth/errors'
import type { SubscriptionPlan } from '@/types/domain'

type FeatureKey = keyof SubscriptionPlan['features']

const FEATURES: Array<{ key: FeatureKey; label: string }> = [
  { key: 'advanced_analytics', label: 'Advanced analytics' },
  { key: 'custom_branding', label: 'Custom branding' },
  { key: 'white_label', label: 'White label' },
  { key: 'custom_domain', label: 'Custom domain' },
  { key: 'team_members', label: 'Team members' },
  { key: 'api_access', label: 'API access' },
  { key: 'priority_support', label: 'Priority support' },
  { key: 'model_generation', label: 'Model generation' },
]

const LIMIT_HINT = 'Blank means unlimited.'

/** Blank input ↔ no ceiling, the same convention the action stores as NULL. */
const limitValue = (limit: number | null) => (limit === null ? '' : String(limit))

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  )
}

function Checkbox({
  name,
  label,
  defaultChecked,
}: {
  name: string
  label: string
  defaultChecked?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="border-input accent-primary size-4 rounded border"
      />
      {label}
    </label>
  )
}

export default function PlanEditor({ plans }: { plans: SubscriptionPlan[] }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(savePlanAction, null)
  const [selectedId, setSelectedId] = useState('')
  const plan = plans.find((p) => p.id === selectedId) ?? null

  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined

  const storageMb =
    plan && plan.limits.maxStorageBytes !== null
      ? String(Math.round(plan.limits.maxStorageBytes / (1024 * 1024)))
      : ''

  return (
    <div className="space-y-4">
      <Field label="Editing" htmlFor="planPicker">
        <Select
          id="planPicker"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">New plan</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      {/* Remounting on selection is what repopulates the uncontrolled inputs —
          without it the previous plan's values stay on screen. */}
      <form key={selectedId || 'new'} action={action} className="space-y-5">
        <input type="hidden" name="id" value={plan?.id ?? ''} />

        {state && !state.ok && !state.field && <Alert variant="destructive">{state.error}</Alert>}
        {state?.ok && <Alert variant="success">Plan saved.</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required error={fieldError('name')}>
            <Input id="name" name="name" defaultValue={plan?.name ?? ''} required />
          </Field>
          <Field
            label="Slug"
            htmlFor="slug"
            required
            error={fieldError('slug')}
            hint="Used in URLs and never shown to customers."
          >
            <Input id="slug" name="slug" defaultValue={plan?.slug ?? ''} required />
          </Field>
        </div>

        <Field label="Description" htmlFor="description">
          <Textarea
            id="description"
            name="description"
            rows={2}
            defaultValue={plan?.description ?? ''}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Price (₹/month)" htmlFor="price" required error={fieldError('price')}>
            <Input
              id="price"
              name="price"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={plan ? minorToMajor(plan.priceMinor) : 0}
              required
            />
          </Field>
          <Field label="Setup fee (₹)" htmlFor="setupFee" error={fieldError('setupFee')}>
            <Input
              id="setupFee"
              name="setupFee"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={plan ? minorToMajor(plan.setupFeeMinor) : 0}
            />
          </Field>
          <Field label="Trial days" htmlFor="trialDays">
            <Input
              id="trialDays"
              name="trialDays"
              type="number"
              min="0"
              max="365"
              defaultValue={plan?.trialDays ?? 0}
            />
          </Field>
          <Field label="Sort order" htmlFor="sortOrder" hint="Lowest first on the pricing page.">
            <Input
              id="sortOrder"
              name="sortOrder"
              type="number"
              min="0"
              max="100"
              defaultValue={plan?.sortOrder ?? 0}
            />
          </Field>
        </div>

        <div className="space-y-3">
          <div>
            <Label>Limits</Label>
            <p className="text-muted-foreground text-xs">
              {LIMIT_HINT} These are the ceilings every business on this plan is checked against.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Products" htmlFor="maxProducts" hint={LIMIT_HINT}>
              <Input
                id="maxProducts"
                name="maxProducts"
                inputMode="numeric"
                defaultValue={plan ? limitValue(plan.limits.maxProducts) : ''}
              />
            </Field>
            <Field label="AR models" htmlFor="maxArModels" hint={LIMIT_HINT}>
              <Input
                id="maxArModels"
                name="maxArModels"
                inputMode="numeric"
                defaultValue={plan ? limitValue(plan.limits.maxArModels) : ''}
              />
            </Field>
            <Field label="QR codes" htmlFor="maxQrCodes" hint={LIMIT_HINT}>
              <Input
                id="maxQrCodes"
                name="maxQrCodes"
                inputMode="numeric"
                defaultValue={plan ? limitValue(plan.limits.maxQrCodes) : ''}
              />
            </Field>
            <Field label="Team members" htmlFor="maxTeamMembers" hint={LIMIT_HINT}>
              <Input
                id="maxTeamMembers"
                name="maxTeamMembers"
                inputMode="numeric"
                defaultValue={plan ? limitValue(plan.limits.maxTeamMembers) : ''}
              />
            </Field>
            <Field label="Storage (MB)" htmlFor="storageMb" hint={LIMIT_HINT}>
              <Input id="storageMb" name="storageMb" inputMode="numeric" defaultValue={storageMb} />
            </Field>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Features</Label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <Checkbox
                key={f.key}
                name={f.key}
                label={f.label}
                defaultChecked={plan?.features[f.key] ?? false}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-5">
          <Checkbox
            name="isPublic"
            label="Show on the public pricing page"
            defaultChecked={plan?.isPublic ?? true}
          />
          <Checkbox
            name="archived"
            label="Archived"
            defaultChecked={plan?.archived ?? false}
          />
        </div>

        <SubmitButton label={plan ? 'Save changes' : 'Create plan'} />
      </form>
    </div>
  )
}
