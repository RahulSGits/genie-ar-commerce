import { SignInForm } from '@/components/auth/AuthForm'
import { getSessionUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Sign in' }
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  // Already signed in — skip the form rather than showing a dead-end.
  if (await getSessionUser()) redirect('/dashboard')

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Welcome back</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Sign in to manage your products and AR experiences.
      </p>
      <SignInForm />
    </div>
  )
}
