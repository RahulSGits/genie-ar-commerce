/**
 * Per-category terminology.
 *
 * The same product table backs a restaurant's "Menu" and a furniture brand's
 * "Products" — only the words change. Every dashboard label that differs by
 * business category is resolved through here rather than hardcoded in a
 * component, so adding a vertical is a data change.
 */

export const BUSINESS_CATEGORIES = [
  'restaurant',
  'cafe',
  'bakery',
  'clothing',
  'footwear',
  'furniture',
  'jewelry',
  'electronics',
  'other',
] as const

export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number]

export type Terminology = {
  /** What a collection of products is called. */
  catalogSingular: string
  catalogPlural: string
  /** Sidebar label for the catalog section. */
  catalogNavLabel: string
  /** What one sellable thing is called. */
  itemSingular: string
  itemPlural: string
  /** Default call-to-action on the public AR page. */
  defaultCtaLabel: string
  /** Where the AR object is expected to sit — drives default placement mode. */
  defaultPlacement: PlacementMode
  /** Whether food-specific fields (allergens, veg/non-veg) are shown. */
  showFoodFields: boolean
  /** Whether apparel fields (sizes, materials, colourways) are shown. */
  showApparelFields: boolean
}

/**
 * Where a model is anchored in the real world. Drives both the AR reticle
 * behaviour and the default real-world scale.
 */
export const PLACEMENT_MODES = [
  'tabletop', // plates, cups, small objects — sits on a raised surface
  'floor', // furniture — sits on the ground plane
  'wall', // art, mirrors, signage — vertical plane
  'handheld', // jewelry, watches, small accessories — held near the camera
] as const

export type PlacementMode = (typeof PLACEMENT_MODES)[number]

const FOOD: Terminology = {
  catalogSingular: 'Menu',
  catalogPlural: 'Menus',
  catalogNavLabel: 'Menu',
  itemSingular: 'Dish',
  itemPlural: 'Dishes',
  defaultCtaLabel: 'Order Now',
  defaultPlacement: 'tabletop',
  showFoodFields: true,
  showApparelFields: false,
}

const APPAREL: Terminology = {
  catalogSingular: 'Catalog',
  catalogPlural: 'Catalogs',
  catalogNavLabel: 'Catalog',
  itemSingular: 'Product',
  itemPlural: 'Products',
  defaultCtaLabel: 'Buy Now',
  defaultPlacement: 'floor',
  showFoodFields: false,
  showApparelFields: true,
}

const GENERIC: Terminology = {
  catalogSingular: 'Catalog',
  catalogPlural: 'Catalogs',
  catalogNavLabel: 'Products',
  itemSingular: 'Product',
  itemPlural: 'Products',
  defaultCtaLabel: 'View Details',
  defaultPlacement: 'floor',
  showFoodFields: false,
  showApparelFields: false,
}

const TERMINOLOGY: Record<BusinessCategory, Terminology> = {
  restaurant: FOOD,
  cafe: FOOD,
  bakery: FOOD,
  clothing: APPAREL,
  footwear: { ...APPAREL, defaultPlacement: 'floor' },
  furniture: { ...GENERIC, defaultPlacement: 'floor', defaultCtaLabel: 'Shop Now' },
  jewelry: { ...GENERIC, defaultPlacement: 'handheld', defaultCtaLabel: 'Buy Now' },
  electronics: { ...GENERIC, defaultPlacement: 'tabletop', defaultCtaLabel: 'Buy Now' },
  other: GENERIC,
}

export function getTerminology(category: BusinessCategory | null | undefined): Terminology {
  if (!category) return GENERIC
  return TERMINOLOGY[category] ?? GENERIC
}

export const BUSINESS_CATEGORY_LABELS: Record<BusinessCategory, string> = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  bakery: 'Bakery',
  clothing: 'Clothing',
  footwear: 'Footwear',
  furniture: 'Furniture',
  jewelry: 'Jewelry',
  electronics: 'Electronics',
  other: 'Other',
}

/**
 * Default real-world size hints per placement mode, in metres (longest
 * horizontal edge). Used only when a product has no explicit dimensions — a
 * model that lands at a plausible size beats one that lands 40× too large.
 */
export const PLACEMENT_DEFAULT_SIZE_M: Record<PlacementMode, number> = {
  tabletop: 0.26, // a dinner plate
  floor: 0.9, // an armchair
  wall: 0.6, // a framed print
  handheld: 0.08, // a watch face
}

export const PLACEMENT_LABELS: Record<PlacementMode, string> = {
  tabletop: 'Tabletop — sits on a table',
  floor: 'Floor — sits on the ground',
  wall: 'Wall — mounts vertically',
  handheld: 'Handheld — small, held close',
}
