import type { PlacementMode } from '@/config/terminology'

/**
 * The AR subsystem deliberately does NOT depend on the database row shape.
 * It consumes this narrow view, which the public route maps into. That keeps
 * the renderer reusable, keeps private columns (cost price, internal notes,
 * business billing state) structurally unable to reach the client, and means
 * the AR engine can be unit-tested without a database.
 */

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft'

export type Dimensions = {
  width: number
  height: number
  depth: number
  unit: LengthUnit
}

/** Metres per one unit. Everything is normalised to metres before it reaches Three.js. */
const METRES_PER_UNIT: Record<LengthUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
}

export function toMetres(value: number, unit: LengthUnit): number {
  return value * METRES_PER_UNIT[unit]
}

/**
 * Half the longest horizontal edge, in metres — the scalar the loader needs to
 * size a normalised model. Returns null when the business hasn't supplied
 * dimensions, in which case the placement-mode default is used instead.
 */
export function horizontalRadiusM(dims: Dimensions | null | undefined): number | null {
  if (!dims) return null
  const w = toMetres(dims.width, dims.unit)
  const d = toMetres(dims.depth, dims.unit)
  const longest = Math.max(w, d)
  return longest > 0 ? longest / 2 : null
}

/** A 3D asset attached to a product. */
export type ArModelAsset = {
  id: string
  /** Public URL to the GLB/GLTF. Required for every AR path except iOS Quick Look. */
  glbUrl: string | null
  /** Public URL to the USDZ. Required for iOS AR Quick Look, optional otherwise. */
  usdzUrl: string | null
  fileSizeBytes: number | null
  /** Set once server-side validation has passed; unvalidated models never render. */
  status: 'processing' | 'ready' | 'failed'
}

/**
 * Everything the public AR page is allowed to know about a product.
 * Intentionally a strict subset of the products table.
 */
export type PublicArProduct = {
  id: string
  name: string
  slug: string
  description: string | null
  shortDescription: string | null
  /** Minor units. Null when the business chooses not to display a price. */
  priceMinor: number | null
  compareAtPriceMinor: number | null
  currency: string
  imageUrl: string | null

  model: ArModelAsset | null
  dimensions: Dimensions | null
  placement: PlacementMode
  /** Extra multiplier for GLBs authored at an odd scale. Defaults to 1. */
  scaleMultiplier: number
  /** Resting rotation in radians, applied on placement. */
  rotation: [number, number, number]
  arEnabled: boolean

  ctaLabel: string | null
  ctaUrl: string | null

  business: PublicArBusiness
}

/** The slice of a business shown on a public AR page. Nothing billing-related. */
export type PublicArBusiness = {
  name: string
  slug: string
  logoUrl: string | null
  /** Hex, drives white-label theming of the public page. */
  brandColor: string | null
  websiteUrl: string | null
}

/* ── capability tiers ───────────────────────────────────────────────────── */

/**
 * How AR will actually be delivered on this device, best first. Chosen at
 * runtime — never inferred from the user agent alone, and never assumed.
 *
 * quicklook  iOS AR Quick Look. True 6DoF with real plane detection, handled
 *            by the OS. Requires a USDZ asset.
 * sceneviewer Android Scene Viewer via ARCore. True 6DoF. Requires a GLB at an
 *            absolute https URL and Google Play Services for AR installed.
 * webxr      In-browser immersive-ar with hit-test. True 6DoF, stays inside our
 *            own UI so we keep full control of the overlay.
 * camera     Live camera feed with the model anchored by device orientation.
 *            3DoF only: holds its bearing as you pan, but cannot track you
 *            walking around it. The honest fallback for iOS without a USDZ.
 * viewer     No camera. Interactive 3D turntable only.
 */
export type ArTier = 'quicklook' | 'sceneviewer' | 'webxr' | 'camera' | 'viewer'

export type ArCapabilities = {
  tier: ArTier
  /** Every tier this device could support, so the UI can offer a manual switch. */
  available: ArTier[]
  hasWebXr: boolean
  hasCamera: boolean
  hasOrientationSensor: boolean
  /** True when the page is not a secure context, which blocks the camera entirely. */
  insecureOrigin: boolean
  isIOS: boolean
  isAndroid: boolean
  /** True for genuine 6DoF world tracking — used to word the UI honestly. */
  hasWorldTracking: boolean
}

/** Stage of the in-browser AR session. Drives the instruction copy and reticle. */
export type ArStage = 'scanning' | 'ready' | 'placed'

/* ── analytics funnel ───────────────────────────────────────────────────── */

/**
 * The public funnel, in order. Kept here rather than in the analytics module
 * because the AR components are what emit most of these.
 */
export const AR_FUNNEL_EVENTS = [
  'qr_scanned',
  'product_loaded',
  'viewer_3d_opened',
  'ar_clicked',
  'ar_session_started',
  'ar_object_placed',
  'cta_clicked',
] as const

export type ArFunnelEvent = (typeof AR_FUNNEL_EVENTS)[number]
