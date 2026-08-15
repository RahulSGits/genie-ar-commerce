import 'server-only'

import {
  getDb, now, uuid, parseJson, toJson, toBool, fromBool,
  str, strOrNull, num, numOrNull, param,
  type Row, type SqlParam,
} from '@/lib/db'
import type { CurrencyCode } from '@/utils/money'
import type { PlacementMode } from '@/config/terminology'
import type { LengthUnit } from '@/types/ar'
import type {
  DietTag, MenuCategory, ModelStatus, Product, ProductStatus,
  ProductWithModel, ThreeDModel,
} from '@/types/domain'

/* ── mappers ────────────────────────────────────────────────────────────── */

function mapModel(row: Row): ThreeDModel {
  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    name: str(row, 'name'),
    glbUrl: strOrNull(row, 'glb_url'),
    usdzUrl: strOrNull(row, 'usdz_url'),
    posterUrl: strOrNull(row, 'poster_url'),
    fileSizeBytes: num(row, 'file_size_bytes'),
    format: strOrNull(row, 'format'),
    triangleCount: numOrNull(row, 'triangle_count'),
    status: (str(row, 'status') || 'processing') as ModelStatus,
    errorMessage: strOrNull(row, 'error_message'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  }
}

function mapProduct(row: Row): Product {
  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    categoryId: strOrNull(row, 'category_id'),
    modelId: strOrNull(row, 'model_id'),
    name: str(row, 'name'),
    slug: str(row, 'slug'),
    description: strOrNull(row, 'description'),
    shortDescription: strOrNull(row, 'short_description'),
    sku: strOrNull(row, 'sku'),
    priceMinor: numOrNull(row, 'price_minor'),
    compareAtMinor: numOrNull(row, 'compare_at_minor'),
    currency: (str(row, 'currency') || 'INR') as CurrencyCode,
    imageUrl: strOrNull(row, 'image_url'),
    thumbnailUrl: strOrNull(row, 'thumbnail_url'),
    dimWidth: numOrNull(row, 'dim_width'),
    dimHeight: numOrNull(row, 'dim_height'),
    dimDepth: numOrNull(row, 'dim_depth'),
    dimUnit: (str(row, 'dim_unit') || 'cm') as LengthUnit,
    weightGrams: numOrNull(row, 'weight_grams'),
    placement: (str(row, 'placement') || 'tabletop') as PlacementMode,
    scaleMultiplier: num(row, 'scale_multiplier', 1),
    rotationY: num(row, 'rotation_y'),
    arEnabled: toBool(row.ar_enabled),
    ctaLabel: strOrNull(row, 'cta_label'),
    ctaUrl: strOrNull(row, 'cta_url'),
    status: (str(row, 'status') || 'draft') as ProductStatus,
    isFeatured: toBool(row.is_featured),
    isBestseller: toBool(row.is_bestseller),
    isAvailable: toBool(row.is_available),
    sortOrder: num(row, 'sort_order'),
    tags: parseJson<string[]>(row.tags, []),
    allergens: parseJson<string[]>(row.allergens, []),
    diet: (strOrNull(row, 'diet') as DietTag | null) ?? null,
    materials: parseJson<string[]>(row.materials, []),
    colors: parseJson<string[]>(row.colors, []),
    sizes: parseJson<string[]>(row.sizes, []),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  }
}

/* ── 3D models ──────────────────────────────────────────────────────────── */

export function listModels(businessId: string): ThreeDModel[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM three_d_models
        WHERE business_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC`,
    )
    .all(businessId) as Row[]
  return rows.map(mapModel)
}

/** Tenant-scoped by construction — businessId is not optional. */
export function getModel(businessId: string, id: string): ThreeDModel | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM three_d_models
        WHERE id = ? AND business_id = ? AND deleted_at IS NULL`,
    )
    .get(id, businessId) as Row | undefined
  return row ? mapModel(row) : null
}

export function createModel(input: {
  businessId: string
  name: string
  glbUrl?: string | null
  usdzUrl?: string | null
  posterUrl?: string | null
  fileSizeBytes?: number
  format?: string | null
  triangleCount?: number | null
  status?: ModelStatus
}): string {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO three_d_models
         (id, business_id, name, glb_url, usdz_url, poster_url, file_size_bytes,
          format, triangle_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, input.businessId, input.name, input.glbUrl ?? null, input.usdzUrl ?? null,
      input.posterUrl ?? null, input.fileSizeBytes ?? 0, input.format ?? null,
      input.triangleCount ?? null, input.status ?? 'processing', ts, ts,
    )
  return id
}

export function updateModel(
  businessId: string,
  id: string,
  patch: Partial<{
    name: string; glbUrl: string | null; usdzUrl: string | null; posterUrl: string | null
    status: ModelStatus; errorMessage: string | null; fileSizeBytes: number
    triangleCount: number | null
  }>,
): void {
  const map: Record<string, string> = {
    name: 'name', glbUrl: 'glb_url', usdzUrl: 'usdz_url', posterUrl: 'poster_url',
    status: 'status', errorMessage: 'error_message', fileSizeBytes: 'file_size_bytes',
    triangleCount: 'triangle_count',
  }
  const sets: string[] = []
  const params: SqlParam[] = []
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k]
    if (!col) continue
    sets.push(`${col} = ?`)
    params.push(param(v ?? null))
  }
  if (!sets.length) return
  sets.push('updated_at = ?')
  params.push(now(), id, businessId)
  getDb()
    .prepare(`UPDATE three_d_models SET ${sets.join(', ')} WHERE id = ? AND business_id = ?`)
    .run(...params)
}

export function deleteModel(businessId: string, id: string): void {
  getDb()
    .prepare(`UPDATE three_d_models SET deleted_at = ? WHERE id = ? AND business_id = ?`)
    .run(now(), id, businessId)
}

/* ── categories ─────────────────────────────────────────────────────────── */

export function listCategories(businessId: string): MenuCategory[] {
  const rows = getDb()
    .prepare(
      `SELECT c.*, (
          SELECT COUNT(*) FROM products p
           WHERE p.category_id = c.id AND p.deleted_at IS NULL
        ) AS product_count
         FROM menu_categories c
        WHERE c.business_id = ? AND c.deleted_at IS NULL
        ORDER BY c.sort_order ASC, c.name ASC`,
    )
    .all(businessId) as Row[]

  return rows.map((r) => ({
    id: str(r, 'id'),
    businessId: str(r, 'business_id'),
    name: str(r, 'name'),
    slug: str(r, 'slug'),
    description: strOrNull(r, 'description'),
    sortOrder: num(r, 'sort_order'),
    isPublished: toBool(r.is_published),
    productCount: num(r, 'product_count'),
  }))
}

export function createCategory(input: {
  businessId: string; name: string; slug: string; sortOrder?: number
}): string {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO menu_categories (id, business_id, name, slug, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.businessId, input.name, input.slug, input.sortOrder ?? 0, ts, ts)
  return id
}

/** Persists a drag-and-drop reorder in one transaction. */
export function reorderCategories(businessId: string, orderedIds: string[]): void {
  const stmt = getDb().prepare(
    `UPDATE menu_categories SET sort_order = ?, updated_at = ? WHERE id = ? AND business_id = ?`,
  )
  const ts = now()
  orderedIds.forEach((id, index) => stmt.run(index, ts, id, businessId))
}

/* ── products ───────────────────────────────────────────────────────────── */

export type ProductFilters = {
  search?: string
  status?: ProductStatus | 'all'
  categoryId?: string
  arOnly?: boolean
  limit?: number
  offset?: number
}

export function listProducts(
  businessId: string,
  filters: ProductFilters = {},
): { rows: ProductWithModel[]; total: number } {
  const db = getDb()
  const where = ['p.business_id = ?', 'p.deleted_at IS NULL']
  const params: SqlParam[] = [businessId]

  if (filters.search) {
    where.push('(p.name LIKE ? OR p.sku LIKE ?)')
    params.push(`%${filters.search}%`, `%${filters.search}%`)
  }
  if (filters.status && filters.status !== 'all') {
    where.push('p.status = ?')
    params.push(param(filters.status))
  }
  if (filters.categoryId) {
    where.push('p.category_id = ?')
    params.push(param(filters.categoryId))
  }
  if (filters.arOnly) where.push('p.ar_enabled = 1 AND p.model_id IS NOT NULL')

  const whereSql = where.join(' AND ')
  const total = num(
    db.prepare(`SELECT COUNT(*) AS c FROM products p WHERE ${whereSql}`).get(...params) as Row,
    'c',
  )

  const rows = db
    .prepare(
      `SELECT p.*,
              c.name AS category_name,
              m.id AS m_id, m.business_id AS m_business_id, m.name AS m_name,
              m.glb_url AS m_glb_url, m.usdz_url AS m_usdz_url, m.poster_url AS m_poster_url,
              m.file_size_bytes AS m_file_size_bytes, m.format AS m_format,
              m.triangle_count AS m_triangle_count, m.status AS m_status,
              m.error_message AS m_error_message, m.created_at AS m_created_at,
              m.updated_at AS m_updated_at,
              (SELECT COUNT(*) FROM qr_codes q
                WHERE q.product_id = p.id AND q.deleted_at IS NULL) AS qr_count
         FROM products p
         LEFT JOIN menu_categories c ON c.id = p.category_id
         LEFT JOIN three_d_models m ON m.id = p.model_id AND m.deleted_at IS NULL
        WHERE ${whereSql}
        ORDER BY p.sort_order ASC, p.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, filters.limit ?? 100, filters.offset ?? 0) as Row[]

  return {
    total,
    rows: rows.map((r) => ({
      ...mapProduct(r),
      categoryName: strOrNull(r, 'category_name'),
      qrCount: num(r, 'qr_count'),
      model: r.m_id
        ? mapModel({
            id: r.m_id, business_id: r.m_business_id, name: r.m_name,
            glb_url: r.m_glb_url, usdz_url: r.m_usdz_url, poster_url: r.m_poster_url,
            file_size_bytes: r.m_file_size_bytes, format: r.m_format,
            triangle_count: r.m_triangle_count, status: r.m_status,
            error_message: r.m_error_message, created_at: r.m_created_at,
            updated_at: r.m_updated_at,
          })
        : null,
    })),
  }
}

export function getProduct(businessId: string, id: string): Product | null {
  const row = getDb()
    .prepare(`SELECT * FROM products WHERE id = ? AND business_id = ? AND deleted_at IS NULL`)
    .get(id, businessId) as Row | undefined
  return row ? mapProduct(row) : null
}

/**
 * Public lookup by slug pair. Enforces published+available here rather than at
 * the call site, so an unpublished draft can never leak through a guessed URL.
 */
export function getPublicProduct(
  businessSlug: string,
  productSlug: string,
): { product: Product; model: ThreeDModel | null } | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT p.* FROM products p
         JOIN businesses b ON b.id = p.business_id
        WHERE b.slug = ? AND p.slug = ?
          AND p.status = 'published'
          AND p.deleted_at IS NULL
          AND b.deleted_at IS NULL
          AND b.status = 'active'`,
    )
    .get(businessSlug, productSlug) as Row | undefined

  if (!row) return null
  const product = mapProduct(row)

  const model = product.modelId
    ? ((db
        .prepare(`SELECT * FROM three_d_models WHERE id = ? AND deleted_at IS NULL`)
        .get(product.modelId) as Row | undefined) ?? null)
    : null

  return { product, model: model ? mapModel(model) : null }
}

export function listPublicProducts(businessSlug: string): Product[] {
  const rows = getDb()
    .prepare(
      `SELECT p.* FROM products p
         JOIN businesses b ON b.id = p.business_id
        WHERE b.slug = ? AND p.status = 'published' AND p.deleted_at IS NULL
          AND b.deleted_at IS NULL AND b.status = 'active'
        ORDER BY p.sort_order ASC, p.created_at DESC`,
    )
    .all(businessSlug) as Row[]
  return rows.map(mapProduct)
}

export type ProductInput = {
  name: string
  slug: string
  categoryId?: string | null
  modelId?: string | null
  description?: string | null
  shortDescription?: string | null
  sku?: string | null
  priceMinor?: number | null
  compareAtMinor?: number | null
  currency?: CurrencyCode
  imageUrl?: string | null
  dimWidth?: number | null
  dimHeight?: number | null
  dimDepth?: number | null
  dimUnit?: LengthUnit
  placement?: PlacementMode
  scaleMultiplier?: number
  arEnabled?: boolean
  ctaLabel?: string | null
  ctaUrl?: string | null
  status?: ProductStatus
  isFeatured?: boolean
  isBestseller?: boolean
  isAvailable?: boolean
  diet?: DietTag | null
  tags?: string[]
  allergens?: string[]
}

export function createProduct(businessId: string, input: ProductInput): string {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO products
         (id, business_id, category_id, model_id, name, slug, description, short_description,
          sku, price_minor, compare_at_minor, currency, image_url,
          dim_width, dim_height, dim_depth, dim_unit,
          placement, scale_multiplier, ar_enabled, cta_label, cta_url,
          status, is_featured, is_bestseller, is_available, diet, tags, allergens,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, businessId, input.categoryId ?? null, input.modelId ?? null,
      input.name, input.slug, input.description ?? null, input.shortDescription ?? null,
      input.sku ?? null, input.priceMinor ?? null, input.compareAtMinor ?? null,
      input.currency ?? 'INR', input.imageUrl ?? null,
      input.dimWidth ?? null, input.dimHeight ?? null, input.dimDepth ?? null,
      input.dimUnit ?? 'cm',
      input.placement ?? 'tabletop', input.scaleMultiplier ?? 1,
      fromBool(input.arEnabled ?? true), input.ctaLabel ?? null, input.ctaUrl ?? null,
      input.status ?? 'draft', fromBool(input.isFeatured), fromBool(input.isBestseller),
      fromBool(input.isAvailable ?? true), input.diet ?? null,
      toJson(input.tags ?? []), toJson(input.allergens ?? []), ts, ts,
    )
  return id
}

const PRODUCT_COLUMN_MAP: Record<string, string> = {
  name: 'name', slug: 'slug', categoryId: 'category_id', modelId: 'model_id',
  description: 'description', shortDescription: 'short_description', sku: 'sku',
  priceMinor: 'price_minor', compareAtMinor: 'compare_at_minor', currency: 'currency',
  imageUrl: 'image_url', thumbnailUrl: 'thumbnail_url',
  dimWidth: 'dim_width', dimHeight: 'dim_height', dimDepth: 'dim_depth', dimUnit: 'dim_unit',
  weightGrams: 'weight_grams', placement: 'placement', scaleMultiplier: 'scale_multiplier',
  rotationY: 'rotation_y', arEnabled: 'ar_enabled', ctaLabel: 'cta_label', ctaUrl: 'cta_url',
  status: 'status', isFeatured: 'is_featured', isBestseller: 'is_bestseller',
  isAvailable: 'is_available', sortOrder: 'sort_order', diet: 'diet',
  tags: 'tags', allergens: 'allergens', materials: 'materials', colors: 'colors', sizes: 'sizes',
}

const BOOLEAN_KEYS = new Set(['arEnabled', 'isFeatured', 'isBestseller', 'isAvailable'])
const JSON_KEYS = new Set(['tags', 'allergens', 'materials', 'colors', 'sizes'])

export function updateProduct(
  businessId: string,
  id: string,
  patch: Record<string, unknown>,
): void {
  const sets: string[] = []
  const params: SqlParam[] = []

  for (const [key, value] of Object.entries(patch)) {
    const col = PRODUCT_COLUMN_MAP[key]
    if (!col) continue
    sets.push(`${col} = ?`)
    if (BOOLEAN_KEYS.has(key)) params.push(param(fromBool(Boolean(value))))
    else if (JSON_KEYS.has(key)) params.push(param(toJson(value)))
    else params.push(param(value ?? null))
  }
  if (!sets.length) return

  sets.push('updated_at = ?')
  params.push(now(), id, businessId)
  getDb()
    .prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND business_id = ?`)
    .run(...params)
}

export function deleteProduct(businessId: string, id: string): void {
  getDb()
    .prepare(`UPDATE products SET deleted_at = ?, status = 'archived' WHERE id = ? AND business_id = ?`)
    .run(now(), id, businessId)
}

export function productSlugAvailable(
  businessId: string,
  slug: string,
  exceptId?: string,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM products
        WHERE business_id = ? AND slug = ? AND deleted_at IS NULL
        ${exceptId ? 'AND id != ?' : ''}`,
    )
    .get(...(exceptId ? [businessId, slug, exceptId] : [businessId, slug])) as Row | undefined
  return !row
}
