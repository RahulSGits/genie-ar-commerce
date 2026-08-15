import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { listCollectionProducts, listCollections } from '@/lib/db/repositories/generation'
import { listProducts } from '@/lib/db/repositories/catalog'
import { getTerminology } from '@/config/terminology'
import CollectionsManager, {
  type CollectionProductOption,
} from '@/components/dashboard/CollectionsManager'

export const metadata = { title: 'Collections' }
export const dynamic = 'force-dynamic'

export default async function CollectionsPage() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const terminology = getTerminology(business.category)

  const collections = listCollections(ctx.businessId)
  const { rows } = listProducts(ctx.businessId, { limit: 500 })

  const products: CollectionProductOption[] = rows.map((p) => ({
    id: p.id,
    name: p.name,
    imageUrl: p.imageUrl,
    priceMinor: p.priceMinor,
    currency: p.currency,
  }))

  // Membership travels as ids only. The editor renders every product from
  // `products` regardless, so shipping each member's full record a second time
  // would double the payload to say nothing new.
  const memberIds: Record<string, string[]> = Object.fromEntries(
    collections.map((c) => [
      c.id,
      listCollectionProducts(ctx.businessId, c.id).map((p) => p.id),
    ]),
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Collections</h1>
        <p className="text-muted-foreground text-sm">
          Group {terminology.itemPlural.toLowerCase()} into menus, drops and catalogues. A
          collection can point a QR code at a curated set instead of everything you sell.
        </p>
      </header>

      <CollectionsManager
        collections={collections}
        products={products}
        memberIds={memberIds}
        itemPlural={terminology.itemPlural}
      />
    </div>
  )
}
