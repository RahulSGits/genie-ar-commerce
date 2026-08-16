import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth/guards'
import {
  getCampaign,
  listCampaignProducts,
} from '@/lib/db/repositories/campaigns'
import { listProducts } from '@/lib/db/repositories/catalog'
import { listQrCodes, qrTargetUrl } from '@/lib/db/repositories/qr'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import CampaignDetail, {
  type CampaignProductOption,
  type CampaignQr,
} from '@/components/dashboard/CampaignDetail'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission('campaigns:read')
  const campaign = getCampaign(ctx.businessId, (await params).id)
  return { title: campaign?.name ?? 'Campaign' }
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission('campaigns:read')
  const { id } = await params

  const campaign = getCampaign(ctx.businessId, id)
  if (!campaign) notFound()

  const business = getBusinessById(ctx.businessId)
  const { rows } = listProducts(ctx.businessId, { limit: 500 })

  const products: CampaignProductOption[] = rows.map((product) => ({
    id: product.id,
    name: product.name,
    imageUrl: product.imageUrl,
    status: product.status,
  }))

  const selectedIds = listCampaignProducts(ctx.businessId, id).map((product) => product.id)

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const qrCodes: CampaignQr[] = listQrCodes(ctx.businessId)
    .filter((code) => code.campaign === campaign.name)
    .map((code) => ({
      id: code.id,
      label: code.label,
      url: qrTargetUrl(code.token, origin),
      scanCount: code.scanCount,
      isActive: code.isActive,
    }))

  return (
    <CampaignDetail
      campaign={campaign}
      products={products}
      selectedIds={selectedIds}
      qrCodes={qrCodes}
      publicUrl={`/c/${business?.slug ?? ''}/${campaign.slug}`}
    />
  )
}
