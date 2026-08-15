import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { Card, CardContent } from '@/components/ui'
import BusinessProfileForm from '@/components/dashboard/BusinessProfileForm'

export const metadata = { title: 'Business Profile' }
export const dynamic = 'force-dynamic'

export default async function BusinessProfilePage() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const publicPath = `/ar/${business.slug}`

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Business Profile</h1>
        <p className="text-muted-foreground text-sm">
          Everything here is visible to anyone who scans one of your QR codes.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Your public page
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
        </CardContent>
      </Card>

      <BusinessProfileForm business={business} />
    </div>
  )
}
