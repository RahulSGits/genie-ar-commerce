'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, Button, Field, Input, Label, Select, Textarea } from '@/components/ui'
import { savePromotionAction, saveCouponAction } from '@/lib/actions/admin'
import type { ActionResult } from '@/lib/auth/errors'
import type { Promotion } from '@/types/domain'

/** `<input type="date">` only accepts YYYY-MM-DD; everything is stored as ISO. */
const dateValue = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

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

export default function OfferEditor({ promotions }: { promotions: Promotion[] }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    savePromotionAction,
    null,
  )
  const [selectedId, setSelectedId] = useState('')
  const promo = promotions.find((p) => p.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <Field label="Editing" htmlFor="promoPicker">
        <Select
          id="promoPicker"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">New campaign</option>
          {promotions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      {/* Remounting on selection is what repopulates the uncontrolled inputs. */}
      <form key={selectedId || 'new'} action={action} className="space-y-5">
        <input type="hidden" name="id" value={promo?.id ?? ''} />

        {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
        {state?.ok && <Alert variant="success">Campaign saved.</Alert>}

        <Field label="Campaign name" htmlFor="name" required>
          <Input id="name" name="name" defaultValue={promo?.name ?? ''} required />
        </Field>

        <Field label="Description" htmlFor="promoDescription">
          <Textarea
            id="promoDescription"
            name="description"
            rows={2}
            defaultValue={promo?.description ?? ''}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Discount type" htmlFor="promoDiscountType">
            <Select
              id="promoDiscountType"
              name="discountType"
              defaultValue={promo?.discountType ?? 'percentage'}
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </Select>
          </Field>
          <Field
            label="Discount value"
            htmlFor="promoDiscountValue"
            hint="A percentage, or a flat rupee amount."
          >
            <Input
              id="promoDiscountValue"
              name="discountValue"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={promo?.discountValue ?? 0}
            />
          </Field>
          <Field
            label="Coupon code"
            htmlFor="promoCouponCode"
            hint="Optional — shown with the banner."
          >
            <Input
              id="promoCouponCode"
              name="couponCode"
              defaultValue={promo?.couponCode ?? ''}
              className="uppercase"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" htmlFor="startsAt" required>
            <Input
              id="startsAt"
              name="startsAt"
              type="date"
              defaultValue={dateValue(promo?.startsAt ?? null)}
              required
            />
          </Field>
          <Field label="Ends" htmlFor="endsAt" required>
            <Input
              id="endsAt"
              name="endsAt"
              type="date"
              defaultValue={dateValue(promo?.endsAt ?? null)}
              required
            />
          </Field>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <Label>Landing page banner</Label>
            <p className="text-muted-foreground text-xs">
              While the campaign is active and inside its window, this strip appears at the top of
              the public landing page for every visitor. It disappears on its own when the window
              closes.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Banner title" htmlFor="bannerTitle">
              <Input id="bannerTitle" name="bannerTitle" defaultValue={promo?.bannerTitle ?? ''} />
            </Field>
            <Field label="Banner message" htmlFor="bannerMessage">
              <Input
                id="bannerMessage"
                name="bannerMessage"
                defaultValue={promo?.bannerMessage ?? ''}
              />
            </Field>
            <Field label="CTA label" htmlFor="bannerCtaLabel">
              <Input
                id="bannerCtaLabel"
                name="bannerCtaLabel"
                defaultValue={promo?.bannerCtaLabel ?? ''}
              />
            </Field>
            <Field label="CTA link" htmlFor="bannerCtaUrl">
              <Input
                id="bannerCtaUrl"
                name="bannerCtaUrl"
                defaultValue={promo?.bannerCtaUrl ?? ''}
                placeholder="/signup"
              />
            </Field>
            <Field label="Banner colour" htmlFor="bannerColor" hint="Any CSS colour value.">
              <Input
                id="bannerColor"
                name="bannerColor"
                defaultValue={promo?.bannerColor ?? ''}
                placeholder="oklch(0.51 0.21 285)"
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-5">
            <Checkbox
              name="showBanner"
              label="Show the banner"
              defaultChecked={promo?.showBanner ?? true}
            />
            <Checkbox name="isActive" label="Campaign active" defaultChecked={promo?.isActive ?? true} />
          </div>
        </div>

        <SubmitButton label={promo ? 'Save campaign' : 'Create campaign'} />
      </form>
    </div>
  )
}

export function CouponForm() {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(saveCouponAction, null)

  return (
    <form action={action} className="space-y-5">
      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">Coupon saved.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Code"
          htmlFor="code"
          required
          hint="Entering a code that already exists updates that coupon."
        >
          <Input id="code" name="code" required className="uppercase" placeholder="LAUNCH50" />
        </Field>
        <Field label="Description" htmlFor="couponDescription">
          <Input id="couponDescription" name="description" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Discount type" htmlFor="couponDiscountType">
          <Select id="couponDiscountType" name="discountType" defaultValue="percentage">
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </Select>
        </Field>
        <Field
          label="Discount value"
          htmlFor="couponDiscountValue"
          hint="Percent, or rupees for a fixed amount."
        >
          <Input
            id="couponDiscountValue"
            name="discountValue"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            defaultValue={0}
          />
        </Field>
        <Field label="Duration" htmlFor="duration">
          <Select id="duration" name="duration" defaultValue="once">
            <option value="once">Once</option>
            <option value="recurring">Recurring</option>
          </Select>
        </Field>
        <Field label="Expires" htmlFor="expiresAt">
          <Input id="expiresAt" name="expiresAt" type="date" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Max redemptions"
          htmlFor="maxRedemptions"
          hint="Blank means no cap across all businesses."
        >
          <Input id="maxRedemptions" name="maxRedemptions" type="number" min="1" />
        </Field>
        <Field label="Per business limit" htmlFor="perBusinessLimit">
          <Input
            id="perBusinessLimit"
            name="perBusinessLimit"
            type="number"
            min="1"
            defaultValue={1}
          />
        </Field>
      </div>

      <Checkbox name="isActive" label="Coupon active" defaultChecked />

      <SubmitButton label="Save coupon" />
    </form>
  )
}
