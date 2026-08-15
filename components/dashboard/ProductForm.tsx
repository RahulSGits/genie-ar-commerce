'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import {
  Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Field, Input, Select, Separator, Textarea,
} from '@/components/ui'
import { PLACEMENT_LABELS, PLACEMENT_MODES, type PlacementMode } from '@/config/terminology'
import { minorToMajor, type CurrencyCode } from '@/utils/money'
import type { MenuCategory, Product, ThreeDModel } from '@/types/domain'
import type { ActionResult } from '@/lib/auth/errors'

const DIM_UNITS = ['mm', 'cm', 'm', 'in', 'ft'] as const

const STATUSES: { value: string; label: string }[] = [
  { value: 'draft', label: 'Draft — only you can see it' },
  { value: 'published', label: 'Published — live on the AR page' },
  { value: 'archived', label: 'Archived — hidden, kept for records' },
]

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  )
}

/**
 * The single product editor, shared by the create and edit routes.
 *
 * Both routes hand it a server action with the same shape, so the only thing
 * that differs between "new" and "edit" is which action arrives and whether a
 * product is there to prefill from.
 */
export default function ProductForm({
  action,
  submitLabel,
  product,
  categories,
  models,
  currency,
  showFoodFields,
  defaultPlacement,
  defaultCtaLabel,
  deleteAction,
}: {
  action: (prev: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>
  submitLabel: string
  product?: Product
  categories: MenuCategory[]
  models: ThreeDModel[]
  currency: CurrencyCode
  showFoodFields: boolean
  defaultPlacement: PlacementMode
  defaultCtaLabel: string
  /** Present only on edit. Already bound to the product id by the page. */
  deleteAction?: () => Promise<void>
}) {
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(action, null)

  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined

  // Prices are stored as integer paise; the form collects rupees and the action
  // converts back, so the round trip has to happen here too.
  const rupees = (minor: number | null | undefined) =>
    minor === null || minor === undefined ? '' : String(minorToMajor(minor, currency))

  return (
    <div className="space-y-4">
      {state && !state.ok && !state.field && <Alert variant="destructive">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">Saved.</Alert>}

      <form action={formAction} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basics</CardTitle>
            <CardDescription>What customers read before they tap into AR.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Name" htmlFor="name" required error={fieldError('name')}>
              <Input
                id="name"
                name="name"
                defaultValue={product?.name ?? ''}
                maxLength={120}
                required
                autoFocus={!product}
                placeholder="Butter chicken"
              />
            </Field>

            <Field
              label="Short description"
              htmlFor="shortDescription"
              hint="One line, shown under the name on the AR page."
              error={fieldError('shortDescription')}
            >
              <Input
                id="shortDescription"
                name="shortDescription"
                defaultValue={product?.shortDescription ?? ''}
                maxLength={200}
              />
            </Field>

            <Field label="Description" htmlFor="description" error={fieldError('description')}>
              <Textarea
                id="description"
                name="description"
                rows={4}
                maxLength={2000}
                defaultValue={product?.description ?? ''}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Category"
                htmlFor="categoryId"
                hint={categories.length === 0 ? 'No categories yet — optional.' : undefined}
              >
                <Select id="categoryId" name="categoryId" defaultValue={product?.categoryId ?? ''}>
                  <option value="">Uncategorised</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Status" htmlFor="status">
                <Select id="status" name="status" defaultValue={product?.status ?? 'draft'}>
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {showFoodFields && (
              <Field label="Diet" htmlFor="diet">
                <Select id="diet" name="diet" defaultValue={product?.diet ?? ''}>
                  <option value="">Not specified</option>
                  <option value="veg">Vegetarian</option>
                  <option value="egg">Contains egg</option>
                  <option value="non-veg">Non-vegetarian</option>
                </Select>
              </Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">3D model</CardTitle>
            <CardDescription>
              Without a model this stays a plain listing — no AR button appears.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Model"
              htmlFor="modelId"
              hint={
                models.length === 0
                  ? undefined
                  : 'Only models that finished processing are listed here.'
              }
            >
              <Select
                id="modelId"
                name="modelId"
                defaultValue={product?.modelId ?? ''}
                disabled={models.length === 0}
              >
                <option value="">No model</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>

            {models.length === 0 && (
              <Alert>
                You have no ready models yet.{' '}
                <Link href="/dashboard/models" className="text-primary font-medium hover:underline">
                  Upload a .glb
                </Link>{' '}
                and it will show up in this list.
              </Alert>
            )}

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="arEnabled"
                defaultChecked={product?.arEnabled ?? true}
                className="accent-primary mt-0.5 size-4"
              />
              <span className="text-sm">
                <span className="font-medium">Allow AR</span>
                <span className="text-muted-foreground block text-xs">
                  Customers can place it in their room. Turn off to show 3D only.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Real-world size</CardTitle>
            <CardDescription>
              These numbers are what make AR believable: the model is scaled to them, so a plate
              lands the size of a plate rather than the size of a table. Leave them empty and we
              fall back to a rough default for the placement mode.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Width" htmlFor="dimWidth">
                <Input
                  id="dimWidth"
                  name="dimWidth"
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  defaultValue={product?.dimWidth ?? ''}
                />
              </Field>
              <Field label="Height" htmlFor="dimHeight">
                <Input
                  id="dimHeight"
                  name="dimHeight"
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  defaultValue={product?.dimHeight ?? ''}
                />
              </Field>
              <Field label="Depth" htmlFor="dimDepth">
                <Input
                  id="dimDepth"
                  name="dimDepth"
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  defaultValue={product?.dimDepth ?? ''}
                />
              </Field>
              <Field label="Unit" htmlFor="dimUnit">
                <Select id="dimUnit" name="dimUnit" defaultValue={product?.dimUnit ?? 'cm'}>
                  {DIM_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field
              label="Placement"
              htmlFor="placement"
              hint="Decides which surface the AR reticle looks for."
            >
              <Select
                id="placement"
                name="placement"
                defaultValue={product?.placement ?? defaultPlacement}
              >
                {PLACEMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {PLACEMENT_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Price & call to action</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Price" htmlFor="price" error={fieldError('price')}>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  defaultValue={rupees(product?.priceMinor)}
                  placeholder="0.00"
                />
              </Field>
              <Field
                label="Compare-at price"
                htmlFor="compareAt"
                hint="Shown struck through, if higher than the price."
                error={fieldError('compareAt')}
              >
                <Input
                  id="compareAt"
                  name="compareAt"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  defaultValue={rupees(product?.compareAtMinor)}
                  placeholder="0.00"
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button label" htmlFor="ctaLabel">
                <Input
                  id="ctaLabel"
                  name="ctaLabel"
                  maxLength={40}
                  defaultValue={product?.ctaLabel ?? ''}
                  placeholder={defaultCtaLabel}
                />
              </Field>
              <Field
                label="Button link"
                htmlFor="ctaUrl"
                hint="Where the button sends them — your ordering page, WhatsApp, anywhere."
                error={fieldError('ctaUrl')}
              >
                <Input
                  id="ctaUrl"
                  name="ctaUrl"
                  type="url"
                  defaultValue={product?.ctaUrl ?? ''}
                  placeholder="https://"
                />
              </Field>
            </div>

            <Separator />

            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="isFeatured"
                  defaultChecked={product?.isFeatured ?? false}
                  className="accent-primary size-4"
                />
                <span className="text-sm font-medium">Feature it at the top of the catalog</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="isBestseller"
                  defaultChecked={product?.isBestseller ?? false}
                  className="accent-primary size-4"
                />
                <span className="text-sm font-medium">Mark as a bestseller</span>
              </label>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton label={submitLabel} />
          <Button asChild variant="ghost">
            <Link href="/dashboard/products">Cancel</Link>
          </Button>
        </div>
      </form>

      {deleteAction && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base">Delete</CardTitle>
            <CardDescription>
              QR codes pointing here will stop resolving. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={deleteAction}
              onSubmit={(e) => {
                if (!window.confirm('Delete this product? QR codes pointing to it will break.')) {
                  e.preventDefault()
                }
              }}
            >
              <Button type="submit" variant="destructive" size="sm">
                <Trash2 className="size-4" aria-hidden />
                Delete permanently
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
