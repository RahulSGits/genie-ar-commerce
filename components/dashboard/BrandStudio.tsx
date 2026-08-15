'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { ExternalLink, Lock } from 'lucide-react'
import {
  Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Field, Input, Select, Textarea,
} from '@/components/ui'
import { updateProfileAction } from '@/lib/actions/dashboard'
import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS } from '@/config/terminology'
import type { ActionResult } from '@/lib/auth/errors'
import type { Business } from '@/types/domain'

const HEX = /^#[0-9a-fA-F]{6}$/

/** Keeps the picker off pure black while the text box is still empty. */
const SWATCH_FALLBACK = '#e8623c'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? 'Saving…' : 'Save branding'}
    </Button>
  )
}

export default function BrandStudio({
  business,
  customBranding,
  planName,
}: {
  business: Business
  customBranding: boolean
  planName: string
}) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    updateProfileAction,
    null,
  )

  // Mirrored into local state purely so the preview can react as the operator
  // types — the submitted values are still whatever the inputs hold.
  const [name, setName] = useState(business.name)
  const [description, setDescription] = useState(business.description ?? '')
  const [brandColor, setBrandColor] = useState(business.brandColor ?? '')
  const [logoUrl, setLogoUrl] = useState(business.logoUrl ?? '')
  const [coverUrl, setCoverUrl] = useState(business.coverUrl ?? '')

  const fieldError = (field: string) =>
    state && !state.ok && state.field === field ? state.error : undefined

  // Falls back to the theme colour rather than to nothing, because that is
  // exactly what the public page does with a null brand colour.
  const swatch = HEX.test(brandColor) ? brandColor : 'var(--primary)'
  const publicPath = `/ar/${business.slug}`

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-5 lg:items-start">
      <div className="space-y-4 lg:col-span-3">
        {state?.ok && <Alert variant="success">Branding saved.</Alert>}
        {state && !state.ok && !state.field && <Alert variant="destructive">{state.error}</Alert>}

        {!customBranding && (
          <Alert variant="warning">
            <p className="flex items-center gap-1.5 font-medium">
              <Lock className="size-3.5 shrink-0" aria-hidden />
              Custom branding is not included in {planName}
            </p>
            <p className="text-muted-foreground mt-1">
              You can set everything up here and it will be saved, but your public pages keep the
              default GENIE styling until the feature is on your plan.
            </p>
          </Alert>
        )}

        {/* The contact block lives on the Business Profile page, but the action
            writes every profile column on every save — without these the values
            would be absent from the payload and cleared to NULL. */}
        <input type="hidden" name="phone" value={business.phone ?? ''} />
        <input type="hidden" name="email" value={business.email ?? ''} />
        <input type="hidden" name="address" value={business.address ?? ''} />
        <input type="hidden" name="city" value={business.city ?? ''} />
        <input type="hidden" name="whatsappNumber" value={business.whatsappNumber ?? ''} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
            <CardDescription>
              The name, wording and imagery a customer sees before they see a single product.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Business name" htmlFor="name" required error={fieldError('name')}>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="organization"
                maxLength={120}
                required
              />
            </Field>

            <Field
              label="Description"
              htmlFor="description"
              error={fieldError('description')}
              hint="One or two lines, shown under your name on the catalogue page."
            >
              <Textarea
                id="description"
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={3}
              />
            </Field>

            <Field
              label="Business type"
              htmlFor="category"
              required
              error={fieldError('category')}
              hint="Sets the wording used across your public pages."
            >
              <Select id="category" name="category" defaultValue={business.category} required>
                {BUSINESS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BUSINESS_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Logo URL"
                htmlFor="logoUrl"
                error={fieldError('logoUrl')}
                hint="Square image. Replaces the initial tile in the header."
              >
                <Input
                  id="logoUrl"
                  name="logoUrl"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </Field>

              <Field
                label="Cover URL"
                htmlFor="coverUrl"
                error={fieldError('coverUrl')}
                hint="Wide image used as the banner above the header."
              >
                <Input
                  id="coverUrl"
                  name="coverUrl"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={coverUrl}
                  onChange={(e) => setCoverUrl(e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Colour</CardTitle>
            <CardDescription>
              One colour carries the header tile and every call-to-action button.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field
              label="Brand colour"
              htmlFor="brandColor"
              error={fieldError('brandColor')}
              hint="Six-digit hex, like #e8623c. Leave empty to use the default theme colour."
            >
              <div className="flex gap-2">
                {/* Unnamed on purpose: two inputs sharing `brandColor` would put
                    two values in the payload. */}
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
                  pattern="^#[0-9a-fA-F]{6}$"
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
            <CardTitle className="text-base">Links</CardTitle>
            <CardDescription>
              Each filled link becomes a button on your public page. Empty ones are hidden.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
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
              hint="Wherever orders are actually placed."
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
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <SubmitButton />
        </div>
      </div>

      {/* ── live preview ───────────────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              The top of a product page, as it looks right now. Nothing here is saved yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-background overflow-hidden rounded-xl border">
              {coverUrl.trim() && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="h-20 w-full object-cover" />
              )}

              <div className="space-y-4 p-4">
                <div className="flex items-center gap-3">
                  {logoUrl.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="size-9 rounded-lg object-cover" />
                  ) : (
                    <div
                      className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
                      style={{ background: swatch }}
                      aria-hidden
                    >
                      {name.trim().charAt(0) || '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name || 'Your business'}</p>
                    <p className="text-muted-foreground text-xs">View all products</p>
                  </div>
                </div>

                <div className="bg-muted grid h-24 place-items-center rounded-lg">
                  <span className="text-muted-foreground/50 text-xs tracking-[0.2em] uppercase">
                    3D model
                  </span>
                </div>

                <div>
                  <p className="font-semibold">Sample product</p>
                  <p className="text-muted-foreground line-clamp-2 text-xs">
                    {description || 'Your description appears under the business name.'}
                  </p>
                </div>

                <Button
                  type="button"
                  size="lg"
                  className="pointer-events-none w-full"
                  style={{ backgroundColor: swatch }}
                  tabIndex={-1}
                  aria-hidden
                >
                  Order Now
                  <ExternalLink className="size-4" aria-hidden />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Public URL
                </p>
                <p className="truncate font-mono text-sm">{publicPath}</p>
              </div>
              <Link
                href={publicPath}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              >
                Open
                <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </div>
          </CardContent>
        </Card>
      </aside>
    </form>
  )
}
