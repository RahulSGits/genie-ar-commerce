import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { listCategories, listModels } from '@/lib/db/repositories/catalog'
import { createProductAction } from '@/lib/actions/dashboard'
import { getTerminology } from '@/config/terminology'
import ProductForm from '@/components/dashboard/ProductForm'

export const metadata = { title: 'New product' }
export const dynamic = 'force-dynamic'

export default async function NewProductPage() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const terminology = getTerminology(business.category)

  const categories = listCategories(ctx.businessId)
  const models = listModels(ctx.businessId).filter((m) => m.status === 'ready')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/dashboard/products"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {terminology.itemPlural}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">
          New {terminology.itemSingular.toLowerCase()}
        </h1>
        <p className="text-muted-foreground text-sm">
          Save it as a draft first — nothing is public until you publish it.
        </p>
      </header>

      <ProductForm
        action={createProductAction}
        submitLabel={`Create ${terminology.itemSingular.toLowerCase()}`}
        categories={categories}
        models={models}
        currency={business.currency}
        showFoodFields={terminology.showFoodFields}
        defaultPlacement={terminology.defaultPlacement}
        defaultCtaLabel={terminology.defaultCtaLabel}
      />
    </div>
  )
}
