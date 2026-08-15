import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById, getEntitlements } from '@/lib/db/repositories/businesses'
import BrandStudio from '@/components/dashboard/BrandStudio'

export const metadata = { title: 'Brand Studio' }
export const dynamic = 'force-dynamic'

export default async function BrandStudioPage() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const entitlements = getEntitlements(ctx.businessId)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Brand Studio</h1>
        <p className="text-muted-foreground text-sm">
          How your business looks to anyone who scans a QR code. Every product page and catalogue
          page picks these up.
        </p>
      </header>

      <BrandStudio
        business={business}
        customBranding={entitlements.features.custom_branding}
        planName={entitlements.planName}
      />
    </div>
  )
}
