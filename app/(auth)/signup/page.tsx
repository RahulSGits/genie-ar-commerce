import { SignUpForm } from '@/components/auth/AuthForm'
import { getSessionUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Create your account' }
export const dynamic = 'force-dynamic'

export default async function SignUpPage() {
  if (await getSessionUser()) redirect('/dashboard')

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Start a free trial. No card required — we invoice you directly.
      </p>
      <SignUpForm />
    </div>
  )
}
