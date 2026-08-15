'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Alert, Button, Field, Input, Select } from '@/components/ui'
import { signIn, signUp } from '@/lib/auth/actions'
import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS } from '@/config/terminology'
import type { ActionResult } from '@/lib/auth/errors'

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  )
}

export function SignInForm({ admin = false }: { admin?: boolean }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(signIn, null)

  return (
    <form action={action} className="space-y-4">
      {admin && <input type="hidden" name="admin" value="true" />}

      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}

      <Field label="Email" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@business.com"
        />
      </Field>

      <Field label="Password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <SubmitButton label="Sign in" pendingLabel="Signing in…" />

      {!admin && (
        <p className="text-muted-foreground text-center text-sm">
          Don’t have an account?{' '}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            Create one
          </Link>
        </p>
      )}
    </form>
  )
}

export function SignUpForm() {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(signUp, null)
  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : undefined

  return (
    <form action={action} className="space-y-4">
      {state && !state.ok && !state.field && <Alert variant="destructive">{state.error}</Alert>}

      <Field label="Your name" htmlFor="fullName" required error={fieldError('fullName')}>
        <Input id="fullName" name="fullName" autoComplete="name" required autoFocus />
      </Field>

      <Field label="Business name" htmlFor="businessName" required error={fieldError('businessName')}>
        <Input id="businessName" name="businessName" autoComplete="organization" required />
      </Field>

      <Field label="Business type" htmlFor="category" required>
        <Select id="category" name="category" defaultValue="restaurant" required>
          {BUSINESS_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {BUSINESS_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Email" htmlFor="email" required error={fieldError('email')}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        required
        error={fieldError('password')}
        hint="At least 10 characters."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </Field>

      <SubmitButton label="Create account" pendingLabel="Creating account…" />

      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{' '}
        <Link href="/login" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  )
}
