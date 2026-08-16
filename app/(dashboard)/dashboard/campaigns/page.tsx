import { requirePermission } from '@/lib/auth/guards'
import { listCampaigns } from '@/lib/db/repositories/campaigns'
import CampaignsManager from '@/components/dashboard/CampaignsManager'

export const metadata = { title: 'Campaigns' }
export const dynamic = 'force-dynamic'

export default async function CampaignsPage() {
  const ctx = await requirePermission('campaigns:read')
  const campaigns = listCampaigns(ctx.businessId)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          A campaign is a dated set of products behind its own QR code and landing page. Because the
          code points at the campaign rather than at a product, you can swap what it promotes
          without reprinting anything.
        </p>
      </header>

      <CampaignsManager campaigns={campaigns} />
    </div>
  )
}
