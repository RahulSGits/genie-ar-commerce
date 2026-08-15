import { SignInForm } from '@/components/auth/AuthForm'
import { Alert } from '@/components/ui'

export const metadata = { title: 'Admin sign in', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

/** Separate entry point for the platform owner. Never linked from public nav. */
export default function AdminLoginPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Platform admin</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Restricted access. Business accounts should sign in at /login.
      </p>
      <SignInForm admin />
      <Alert className="mt-6 text-xs">
        All administrative actions are recorded in the audit log.
      </Alert>
    </div>
  )
}
