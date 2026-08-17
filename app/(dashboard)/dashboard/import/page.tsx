import { requirePermission } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import ImportProducts from '@/components/dashboard/ImportProducts'
import { getTerminology } from '@/config/terminology'

export const metadata = { title: 'Import' }
export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const ctx = await requirePermission('products:write')
  const business = getBusinessById(ctx.businessId)
  const terminology = getTerminology(business?.category)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Import {terminology.itemPlural}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Bring in a whole catalogue from a spreadsheet instead of typing it. Everything arrives as a
          draft, so you decide what goes live and when.
        </p>
      </header>

      <ImportProducts currency={business?.currency ?? 'INR'} />
    </div>
  )
}
