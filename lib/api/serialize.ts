import type { Product, ThreeDModel } from '@/types/domain'

/**
 * The public API's response shapes.
 *
 * Deliberately hand-written rather than returning the domain object directly.
 * Serialising the row means every new internal column leaks into a contract
 * customers have built against — including columns that should never leave the
 * server. An explicit mapper makes exposing a field a decision.
 */

export function serializeProduct(product: Product, model?: ThreeDModel | null) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description,
    brand: product.brand,
    // Money crosses the wire in minor units with its currency, never as a
    // float — a JSON number for "349.50" is where rounding drift starts.
    price: product.priceMinor === null ? null : { amount: product.priceMinor, currency: product.currency },
    imageUrl: product.imageUrl,
    status: product.status,
    approvalStatus: product.approvalStatus,
    publishAt: product.publishAt,
    unpublishAt: product.unpublishAt,
    arEnabled: product.arEnabled,
    placement: product.placement,
    dimensions:
      product.dimWidth || product.dimHeight || product.dimDepth
        ? {
            width: product.dimWidth,
            height: product.dimHeight,
            depth: product.dimDepth,
            unit: product.dimUnit,
          }
        : null,
    tags: product.tags,
    model: model ? serializeModel(model) : null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  }
}

export function serializeModel(model: ThreeDModel) {
  return {
    id: model.id,
    name: model.name,
    status: model.status,
    glbUrl: model.glbUrl,
    usdzUrl: model.usdzUrl,
    posterUrl: model.posterUrl,
    fileSizeBytes: model.fileSizeBytes,
    triangleCount: model.triangleCount,
    version: model.version,
    // The measured score, not a marketing number. Null when the model
    // predates scoring or could not be parsed.
    quality: model.quality
      ? {
          modelQuality: model.quality.modelQuality,
          mobilePerformance: model.quality.mobilePerformance,
          arReady: model.quality.arReady,
          webReady: model.quality.webReady,
          printReady: model.quality.printReady,
        }
      : null,
    dimensionsM: model.bbox,
    createdAt: model.createdAt,
  }
}
