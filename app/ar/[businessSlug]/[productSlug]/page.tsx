import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublicProduct, listPublicProducts } from '@/lib/db/repositories/catalog'
import { getBusinessBySlug, getEntitlements } from '@/lib/db/repositories/businesses'
import { getBranding } from '@/lib/db/repositories/platform'
import { getTerminology } from '@/config/terminology'
import type { PublicArProduct } from '@/types/ar'
import PublicProductView from '@/components/public/PublicProductView'

/**
 * The public AR product page. The single most important screen in the product:
 * it is what a customer sees seconds after scanning a code on a table.
 *
 * No authentication, no signup, no popups. Server-rendered so the product name,
 * price and poster paint immediately; the 3D model streams in after.
 */

type Params = { businessSlug: string; productSlug: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { businessSlug, productSlug } = await params
  const found = getPublicProduct(businessSlug, productSlug)
  if (!found) return { title: 'Product not found' }

  const business = getBusinessBySlug(businessSlug)
  const title = `${found.product.name}${business ? ` · ${business.name}` : ''}`
  const description =
    found.product.shortDescription ??
    found.product.description ??
    `View ${found.product.name} in 3D and place it in your space.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: found.product.imageUrl ? [found.product.imageUrl] : undefined,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    alternates: { canonical: `/ar/${businessSlug}/${productSlug}` },
  }
}

export default async function PublicArProductPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { businessSlug, productSlug } = await params

  const found = getPublicProduct(businessSlug, productSlug)
  const business = getBusinessBySlug(businessSlug)
  if (!found || !business) notFound()

  const { product, model } = found
  const terminology = getTerminology(business.category)

  // Mapped into the narrow public view — private columns are structurally
  // unable to reach the client from here.
  const publicProduct: PublicArProduct = {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    shortDescription: product.shortDescription,
    priceMinor: product.priceMinor,
    compareAtPriceMinor: product.compareAtMinor,
    currency: product.currency,
    imageUrl: product.imageUrl,
    model: model
      ? {
          id: model.id,
          glbUrl: model.glbUrl,
          usdzUrl: model.usdzUrl,
          fileSizeBytes: model.fileSizeBytes,
          status: model.status,
        }
      : null,
    dimensions:
      product.dimWidth && product.dimHeight && product.dimDepth
        ? {
            width: product.dimWidth,
            height: product.dimHeight,
            depth: product.dimDepth,
            unit: product.dimUnit,
          }
        : null,
    placement: product.placement,
    scaleMultiplier: product.scaleMultiplier,
    rotation: [0, product.rotationY, 0],
    arEnabled: product.arEnabled && Boolean(model?.glbUrl),
    ctaLabel: product.ctaLabel ?? terminology.defaultCtaLabel,
    ctaUrl: product.ctaUrl ?? business.orderingUrl ?? business.storeUrl ?? business.websiteUrl,
    business: {
      name: business.name,
      slug: business.slug,
      logoUrl: business.logoUrl,
      brandColor: business.brandColor,
      websiteUrl: business.websiteUrl,
    },
  }

  // A short list of siblings keeps customers browsing without a full menu page.
  const others = listPublicProducts(businessSlug)
    .filter((p) => p.id !== product.id)
    .slice(0, 6)
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      priceMinor: p.priceMinor,
      currency: p.currency,
      imageUrl: p.imageUrl,
      hasModel: Boolean(p.modelId),
    }))

  const branding = getBranding()
  // The badge comes off only when the business BOTH has white-label on its
  // plan and has switched it off. Either alone leaves it on: a plan feature
  // nobody enabled should not silently change what customers see, and a
  // preference without the entitlement is not something they bought.
  const entitlements = getEntitlements(business.id)
  const showBadge = !(entitlements.features.white_label && !business.showGenieBadge)

  return (
    <PublicProductView
      product={publicProduct}
      allergens={product.allergens}
      diet={product.diet}
      tags={product.tags}
      others={others}
      showFoodFields={terminology.showFoodFields}
      platformName={branding.name}
      showBadge={showBadge}
    />
  )
}
