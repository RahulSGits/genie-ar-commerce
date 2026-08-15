'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, Button, Field, Input, Select } from '@/components/ui'
import { completeOnboardingAction } from '@/lib/auth/actions'
import type { ActionResult } from '@/lib/auth/errors'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? 'Creating…' : 'Create business'}
    </Button>
  )
}

export default function OnboardingForm({
  categories,
}: {
  categories: Array<{ value: string; label: string }>
}) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    completeOnboardingAction,
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
        hint="Shown on your public product pages."
      >
        <Input
          id="businessName"
          name="businessName"
          autoComplete="organization"
          required
          autoFocus
        />
      </Field>

      <Field label="Business type" htmlFor="category" required>
        <Select id="category" name="category" defaultValue="restaurant" required>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="City" htmlFor="city" error={fieldError('city')}>
        <Input id="city" name="city" autoComplete="address-level2" />
      </Field>

      <Submit />

      <p className="text-muted-foreground text-center text-xs">
        You’ll start on a free trial. No card required.
      </p>
    </form>
  )
}
