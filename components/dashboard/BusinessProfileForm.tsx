'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Textarea } from '@/components/ui'
import { updateProfileAction } from '@/lib/actions/dashboard'
import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS } from '@/config/terminology'
import type { ActionResult } from '@/lib/auth/errors'
import type { Business } from '@/types/domain'

const HEX = /^#[0-9a-fA-F]{6}$/

/** Shown in the swatch when no colour is set yet, so the picker isn't black. */
const SWATCH_FALLBACK = '#e8623c'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? 'Saving…' : 'Save changes'}
    </Button>
  )
}

export default function BusinessProfileForm({ business }: { business: Business }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    updateProfileAction,
    null,
  )

  // The picker and the text box edit one value, but only the text box carries
  // the field name — two inputs sharing a name would send two values.
  const [brandColor, setBrandColor] = useState(business.brandColor ?? '')

  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined

  return (
    <form action={action} className="space-y-4">
      {state?.ok && <Alert variant="success">Profile saved.</Alert>}
      {state && !state.ok && !state.field && <Alert variant="destructive">{state.error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
          <CardDescription>
            How your business is named and described on its public AR page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Business name" htmlFor="name" required error={fieldError('name')}>
            <Input
              id="name"
              name="name"
              defaultValue={business.name}
              autoComplete="organization"
              maxLength={120}
              required
            />
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            error={fieldError('description')}
            hint="A sentence or two. Shown under your name on the public page."
          >
            <Textarea
              id="description"
              name="description"
              defaultValue={business.description ?? ''}
              maxLength={1000}
              rows={3}
            />
          </Field>

          <Field
            label="Business type"
            htmlFor="category"
            required
            error={fieldError('category')}
            hint="Drives the wording across your dashboard and the default AR placement."
          >
            <Select id="category" name="category" defaultValue={business.category} required>
              {BUSINESS_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {BUSINESS_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Brand colour"
            htmlFor="brandColor"
            error={fieldError('brandColor')}
            hint="Six-digit hex, like #e8623c. Leave empty to use the default theme."
          >
            <div className="flex gap-2">
              <input
                type="color"
                aria-label="Pick brand colour"
                value={HEX.test(brandColor) ? brandColor : SWATCH_FALLBACK}
                onChange={(e) => setBrandColor(e.target.value)}
                className="border-input bg-background h-10 w-14 shrink-0 cursor-pointer rounded-lg border p-1"
              />
              <Input
                id="brandColor"
                name="brandColor"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#e8623c"
                pattern="#[0-9a-fA-F]{6}"
                maxLength={7}
                spellCheck={false}
                className="font-mono"
              />
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact</CardTitle>
          <CardDescription>
            Where customers reach you after they have seen a product in AR.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="phone" error={fieldError('phone')}>
              <Input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={business.phone ?? ''}
                autoComplete="tel"
                maxLength={30}
              />
            </Field>

            <Field label="Email" htmlFor="email" error={fieldError('email')}>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={business.email ?? ''}
                autoComplete="email"
              />
            </Field>
          </div>

          <Field
            label="WhatsApp number"
            htmlFor="whatsappNumber"
            error={fieldError('whatsappNumber')}
            hint="With country code, e.g. +91 98765 43210."
          >
            <Input
              id="whatsappNumber"
              name="whatsappNumber"
              type="tel"
              defaultValue={business.whatsappNumber ?? ''}
              maxLength={30}
            />
          </Field>

          <Field label="Address" htmlFor="address" error={fieldError('address')}>
            <Textarea
              id="address"
              name="address"
              defaultValue={business.address ?? ''}
              maxLength={300}
              rows={2}
            />
          </Field>

          <Field label="City" htmlFor="city" error={fieldError('city')}>
            <Input
              id="city"
              name="city"
              defaultValue={business.city ?? ''}
              autoComplete="address-level2"
              maxLength={80}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Links</CardTitle>
          <CardDescription>
            Each one becomes a button on your public page. Empty links are hidden.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website" htmlFor="websiteUrl" error={fieldError('websiteUrl')}>
              <Input
                id="websiteUrl"
                name="websiteUrl"
                type="url"
                inputMode="url"
                placeholder="https://"
                defaultValue={business.websiteUrl ?? ''}
              />
            </Field>

            <Field label="Instagram" htmlFor="instagramUrl" error={fieldError('instagramUrl')}>
              <Input
                id="instagramUrl"
                name="instagramUrl"
                type="url"
                inputMode="url"
                placeholder="https://instagram.com/"
                defaultValue={business.instagramUrl ?? ''}
              />
            </Field>

            <Field
              label="Ordering link"
              htmlFor="orderingUrl"
              error={fieldError('orderingUrl')}
              hint="Swiggy, Zomato, your own checkout — wherever orders are placed."
            >
              <Input
                id="orderingUrl"
                name="orderingUrl"
                type="url"
                inputMode="url"
                placeholder="https://"
                defaultValue={business.orderingUrl ?? ''}
              />
            </Field>

            <Field label="Menu link" htmlFor="menuUrl" error={fieldError('menuUrl')}>
              <Input
                id="menuUrl"
                name="menuUrl"
                type="url"
                inputMode="url"
                placeholder="https://"
                defaultValue={business.menuUrl ?? ''}
              />
            </Field>

            <Field label="Store link" htmlFor="storeUrl" error={fieldError('storeUrl')}>
              <Input
                id="storeUrl"
                name="storeUrl"
                type="url"
                inputMode="url"
                placeholder="https://"
                defaultValue={business.storeUrl ?? ''}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  )
}
