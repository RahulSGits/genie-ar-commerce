'use client'

import { useActionState, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { Lock, Play, ShieldOff } from 'lucide-react'
import {
  Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Field, Input, Select, Textarea,
} from '@/components/ui'
import {
  createBusinessAction, saveInternalNotesAction, setBusinessStatusAction,
  updateSubscriptionAction,
} from '@/lib/actions/admin'
import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS } from '@/config/terminology'
import { formatMoney, minorToMajor } from '@/utils/money'
import type { ActionResult } from '@/lib/auth/errors'
import type { Business, Subscription, SubscriptionPlan } from '@/types/domain'

/** Mirrors the statuses `updateSubscriptionAction` accepts. */
const SUBSCRIPTION_STATUS_OPTIONS = [
  ['trialing', 'Trialing'],
  ['active', 'Active'],
  ['past_due', 'Past due'],
  ['grace', 'Grace period'],
  ['suspended', 'Suspended'],
  ['cancelled', 'Cancelled'],
] as const

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  )
}

export default function BusinessAdminPanel({
  businessId,
  businessName,
  businessStatus,
  subscription,
  plans,
  internalNotes,
}: {
  businessId: string
  businessName: string
  businessStatus: Business['status']
  subscription: Subscription | null
  plans: SubscriptionPlan[]
  internalNotes: string | null
}) {
  const [subState, subAction] = useActionState<ActionResult<null> | null, FormData>(
    updateSubscriptionAction.bind(null, businessId),
    null,
  )

  const [notes, setNotes] = useState(internalNotes ?? '')
  const [notesSaved, setNotesSaved] = useState(false)
  const [savingNotes, startNotesSave] = useTransition()
  const [changingStatus, startStatusChange] = useTransition()

  const changeStatus = (status: 'active' | 'suspended', question: string) => {
    if (!window.confirm(question)) return
    startStatusChange(async () => {
      await setBusinessStatusAction(businessId, status)
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subscription</CardTitle>
          <CardDescription>
            A negotiated price lives on this subscription only — the shared plan is never edited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={subAction} className="space-y-4">
            {subState && !subState.ok && <Alert variant="destructive">{subState.error}</Alert>}
            {subState?.ok && <Alert variant="success">Subscription updated.</Alert>}

            <Field label="Plan" htmlFor="planId" required>
              <Select
                id="planId"
                name="planId"
                defaultValue={subscription?.planId ?? plans[0]?.id ?? ''}
                required
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} — {formatMoney({ amount: plan.priceMinor, currency: plan.currency })}
                    {plan.archived ? ' (archived)' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Negotiated price (₹ / period)"
              htmlFor="negotiatedPrice"
              hint="Leave blank to bill the plan's list price."
            >
              <Input
                id="negotiatedPrice"
                name="negotiatedPrice"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                defaultValue={
                  subscription?.negotiatedPriceMinor == null
                    ? ''
                    : minorToMajor(subscription.negotiatedPriceMinor)
                }
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status" htmlFor="status" required>
                <Select
                  id="status"
                  name="status"
                  defaultValue={subscription?.status ?? 'active'}
                  required
                >
                  {SUBSCRIPTION_STATUS_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Grace days"
                htmlFor="graceDays"
                hint="Days past due before access is cut."
              >
                <Input
                  id="graceDays"
                  name="graceDays"
                  type="number"
                  min="0"
                  max="90"
                  step="1"
                  defaultValue={subscription?.graceDays ?? 7}
                />
              </Field>
            </div>

            <SubmitButton label="Save subscription" pendingLabel="Saving…" />
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Access</CardTitle>
            <CardDescription>
              Suspending takes {businessName}&rsquo;s public AR pages offline immediately, for their
              customers as well as their staff.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {businessStatus === 'suspended' ? (
              <Button
                variant="default"
                disabled={changingStatus}
                onClick={() =>
                  changeStatus('active', `Restore access for ${businessName}?`)
                }
              >
                <Play className="size-4" aria-hidden />
                Activate
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={changingStatus}
                onClick={() =>
                  changeStatus(
                    'suspended',
                    `Suspend ${businessName}? Their live QR codes will stop working right away.`,
                  )
                }
              >
                <ShieldOff className="size-4" aria-hidden />
                Suspend
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="text-muted-foreground size-4" aria-hidden />
              Internal notes
            </CardTitle>
            <CardDescription>
              Visible to platform admins only. The business never sees this, so record what you
              actually need — renewal terms, who to call, why a discount was given.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              aria-label="Internal notes"
              rows={6}
              maxLength={4000}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setNotesSaved(false)
              }}
              placeholder="Renewal negotiated at ₹4,000/mo. Owner prefers WhatsApp."
            />
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={savingNotes}
                onClick={() =>
                  startNotesSave(async () => {
                    await saveInternalNotesAction(businessId, notes)
                    setNotesSaved(true)
                  })
                }
              >
                {savingNotes ? 'Saving…' : 'Save notes'}
              </Button>
              {notesSaved && <span className="text-muted-foreground text-sm">Saved.</span>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/**
 * Onboarding form for a business the platform team sets up on the client's
 * behalf — the owner's account is created here rather than by self-signup.
 */
export function CreateBusinessForm({ plans }: { plans: SubscriptionPlan[] }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    createBusinessAction,
    null,
  )
  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined

  return (
    <form action={action} className="space-y-4">
      {state && !state.ok && !state.field && <Alert variant="destructive">{state.error}</Alert>}

      <Field
        label="Business name"
        htmlFor="businessName"
        required
        error={fieldError('businessName')}
        hint="The public catalog URL is derived from this."
      >
        <Input id="businessName" name="businessName" autoFocus required />
      </Field>

      <Field label="Category" htmlFor="category" required error={fieldError('category')}>
        <Select id="category" name="category" defaultValue="restaurant" required>
          {BUSINESS_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {BUSINESS_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Plan" htmlFor="planId" required error={fieldError('planId')}>
        <Select id="planId" name="planId" defaultValue={plans[0]?.id ?? ''} required>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name} — {formatMoney({ amount: plan.priceMinor, currency: plan.currency })}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Owner name" htmlFor="ownerName" required error={fieldError('ownerName')}>
        <Input id="ownerName" name="ownerName" autoComplete="off" required />
      </Field>

      <Field label="Owner email" htmlFor="ownerEmail" required error={fieldError('ownerEmail')}>
        <Input id="ownerEmail" name="ownerEmail" type="email" autoComplete="off" required />
      </Field>

      <Field
        label="Temporary password"
        htmlFor="ownerPassword"
        required
        error={fieldError('ownerPassword')}
        hint="At least 10 characters. Share it with the owner and ask them to change it."
      >
        <Input
          id="ownerPassword"
          name="ownerPassword"
          type="text"
          autoComplete="off"
          minLength={10}
          required
        />
      </Field>

      <SubmitButton label="Create business" pendingLabel="Creating…" />
    </form>
  )
}
