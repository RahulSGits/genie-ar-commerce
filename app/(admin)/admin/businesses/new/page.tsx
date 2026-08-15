import Link from 'next/link'
import { ArrowLeft, Tags } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { listPlans } from '@/lib/db/repositories/businesses'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@/components/ui'
import { CreateBusinessForm } from '@/components/admin/BusinessAdminPanel'

export const metadata = { title: 'Add business' }
export const dynamic = 'force-dynamic'

export default async function NewBusinessPage() {
  await requireSuperAdmin()
  const plans = listPlans({ includeArchived: false })

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/businesses">
            <ArrowLeft className="size-4" aria-hidden />
            Businesses
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add business</h1>
          <p className="text-muted-foreground text-sm">
            Creates the business, its owner login and an active subscription in one step.
          </p>
        </div>
      </header>

      {plans.length === 0 ? (
        <EmptyState
          icon={<Tags />}
          title="No plans to assign"
          description="Every business needs a subscription plan. Create one first, then come back."
          action={
            <Button asChild size="sm">
              <Link href="/admin/pricing">Create a plan</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Client details</CardTitle>
            <CardDescription>
              The owner can sign in immediately with the password you set here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateBusinessForm plans={plans} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
