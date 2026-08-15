import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { getModel, getProduct } from '@/lib/db/repositories/catalog'
import { listQrCodes } from '@/lib/db/repositories/qr'
import DownloadCentre from '@/components/dashboard/DownloadCentre'

export const metadata = { title: 'Downloads' }
export const dynamic = 'force-dynamic'

export default async function ProductDownloadsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!

  const product = getProduct(ctx.businessId, id)
  if (!product) notFound()

  const model = product.modelId ? getModel(ctx.businessId, product.modelId) : null

  // The repository has no per-product query, so the tenant's codes are filtered
  // here. Newest first already, so the first match is the one to print.
  const codes = listQrCodes(ctx.businessId).filter((c) => c.productId === product.id)
  const qr = codes[0] ?? null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <Link
          href={`/dashboard/products/${product.id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {product.name}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Downloads</h1>
        <p className="text-muted-foreground text-sm">
          Every file this product can leave the dashboard as — for your printer, your website,
          or whoever asks for the 3D asset.
        </p>
      </header>

      <DownloadCentre
        product={{
          name: product.name,
          slug: product.slug,
          priceMinor: product.priceMinor,
          currency: product.currency,
          imageUrl: product.imageUrl,
        }}
        model={
          model
            ? {
                name: model.name,
                status: model.status,
                glbUrl: model.glbUrl,
                usdzUrl: model.usdzUrl,
                fileSizeBytes: model.fileSizeBytes,
              }
            : null
        }
        qr={qr ? { token: qr.token, label: qr.label } : null}
        business={{ name: business.name, logoUrl: business.logoUrl }}
      />
    </div>
  )
}
