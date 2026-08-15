import { requireBusiness } from '@/lib/auth/guards'
import { listCategories } from '@/lib/db/repositories/catalog'
import { getFeatureFlags } from '@/lib/db/repositories/platform'
import { generationAvailable, getProvider } from '@/lib/ai3d/provider'
import CreateWizard from '@/components/dashboard/CreateWizard'

export const metadata = { title: 'Create a product' }
export const dynamic = 'force-dynamic'

/**
 * Entry point for the GENIE creation flow.
 *
 * Provider availability is resolved here, on the server, and passed down —
 * the client never guesses whether generation is possible, and credentials
 * never leave the server.
 */
export default async function CreateProductPage() {
  const ctx = await requireBusiness()
  const flags = getFeatureFlags()
  const availability = generationAvailable(flags.model_generation)
  const provider = getProvider()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Create a product</h1>
        <p className="text-muted-foreground text-sm">
          Upload images, add the details, then attach a 3D model.
        </p>
      </header>

      <CreateWizard
        generation={{
          available: availability.available,
          reason: availability.reason,
          providerName: provider.displayName,
        }}
        categories={listCategories(ctx.businessId).map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  )
}
