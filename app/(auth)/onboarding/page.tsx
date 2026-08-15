import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Building2, ShieldCheck } from 'lucide-react'
import { requireUser } from '@/lib/auth/guards'
import { listBusinessesForUser } from '@/lib/db/repositories/businesses'
import { Alert, Button } from '@/components/ui'
import OnboardingForm from '@/components/auth/OnboardingForm'
import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS } from '@/config/terminology'

export const metadata = { title: 'Set up your business' }
export const dynamic = 'force-dynamic'

/**
 * Landing spot for a signed-in user who has no business yet.
 *
 * `requireBusiness()` sends people here, so it must always render something
 * useful. Two distinct cases end up here and they need different answers:
 * an ordinary user mid-signup, and a super admin who has no tenant of their own
 * and almost certainly meant to go to /admin.
 */
export default async function OnboardingPage() {
  const user = await requireUser()
  const businesses = listBusinessesForUser(user.id)

  // Already set up — nothing to do here.
  if (businesses.length > 0) redirect('/dashboard')

  if (user.isSuperAdmin) {
    return (
      <div>
        <div className="bg-primary/10 mb-5 grid size-12 place-items-center rounded-xl">
          <ShieldCheck className="text-primary size-6" aria-hidden />
        </div>
        <h1 className="mb-1 text-2xl font-bold tracking-tight">You’re signed in as an admin</h1>
        <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
          Platform admins don’t have a business of their own. The business dashboard is what
          your clients see — you manage them from the admin area.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link href="/admin">Go to platform admin</Link>
        </Button>
        <Alert className="mt-4 text-xs">
          To see a client’s dashboard, open them from{' '}
          <Link href="/admin/businesses" className="underline underline-offset-2">
            Businesses
          </Link>
          .
        </Alert>
      </div>
    )
  }

  return (
    <div>
      <div className="bg-primary/10 mb-5 grid size-12 place-items-center rounded-xl">
        <Building2 className="text-primary size-6" aria-hidden />
      </div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Set up your business</h1>
      <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
        One more step. This is the name and category customers will see on your AR pages.
      </p>

      <OnboardingForm
        categories={BUSINESS_CATEGORIES.map((c) => ({
          value: c,
          label: BUSINESS_CATEGORY_LABELS[c],
        }))}
      />
    </div>
  )
}
