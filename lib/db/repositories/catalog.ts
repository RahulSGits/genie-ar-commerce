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
  ApprovalStatus, DietTag, MenuCategory, ModelStatus, PageBlock, Product,
  ProductStatus, ProductVariant, ProductWithModel, ThreeDModel,
} from '@/types/domain'
import type { QualityReport } from '@/lib/quality/score'

/**
 * The single definition of "a customer can see this right now".
 *
 * Scheduled publishing is evaluated here, in SQL, rather than by a cron job
 * that flips `status` at the appointed minute. A cron introduces a window
 * where the database disagrees with the schedule — if it is late, or the
 * process is not running, a promotion that was meant to end at midnight is
 * still live at 9am. Deriving visibility on read means the schedule is always
 * exactly true, and there is no job to forget to deploy.
 *
 * Bound parameters: the caller supplies the current ISO timestamp twice.
 */
const VISIBLE_NOW = `
  p.status = 'published'
  AND p.deleted_at IS NULL
  AND (p.publish_at IS NULL OR p.publish_at <= ?)
  AND (p.unpublish_at IS NULL OR p.unpublish_at > ?)
  AND p.approval_status IN ('none', 'approved')`

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
    version: num(row, 'version', 1),
    replacesId: strOrNull(row, 'replaces_id'),
    textureBytes: numOrNull(row, 'texture_bytes'),
    materialCount: numOrNull(row, 'material_count'),
    meshCount: numOrNull(row, 'mesh_count'),
    nodeCount: numOrNull(row, 'node_count'),
    bbox: parseJson<{ x: number; y: number; z: number } | null>(row.bbox, null),
    quality: parseJson<QualityReport | null>(row.quality, null),
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
    brand: strOrNull(row, 'brand'),
    publishAt: strOrNull(row, 'publish_at'),
    unpublishAt: strOrNull(row, 'unpublish_at'),
    approvalStatus: (str(row, 'approval_status') || 'none') as ApprovalStatus,
    approvedBy: strOrNull(row, 'approved_by'),
    approvedAt: strOrNull(row, 'approved_at'),
    pageConfig: parseJson<PageBlock[] | null>(row.page_config, null),
    variants: parseJson<ProductVariant[]>(row.variants, []),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  }
}

export { mapProduct, mapModel }

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
  /** Measured by lib/quality — never supplied by the client. */
  quality?: QualityReport | null
  /** Set when this upload supersedes an existing model (§49). */
  replacesId?: string | null
}): string {
  const id = uuid()
  const ts = now()
  const measured = input.quality?.measured
  const bbox = measured?.size ?? null

  // A replacement continues its predecessor's chain rather than restarting at
  // 1, so "Version 3" means the third asset this product has ever served.
  const version = input.replacesId
    ? num(
        (getDb()
          .prepare(`SELECT version FROM three_d_models WHERE id = ? AND business_id = ?`)
          .get(input.replacesId, input.businessId) as Row) ?? {},
        'version',
        0,
      ) + 1
    : 1

  getDb()
    .prepare(
      `INSERT INTO three_d_models
         (id, business_id, name, glb_url, usdz_url, poster_url, file_size_bytes,
          format, triangle_count, status, version, replaces_id, texture_bytes,
          material_count, mesh_count, bbox, quality, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, input.businessId, input.name, input.glbUrl ?? null, input.usdzUrl ?? null,
      input.posterUrl ?? null, input.fileSizeBytes ?? 0, input.format ?? null,
      // The measured triangle count wins over any caller-supplied one: the file
      // is the authority on what is in the file.
      measured?.triangleCount ?? input.triangleCount ?? null,
      input.status ?? 'processing',
      version,
      param(input.replacesId ?? null),
      param(measured?.textureBytes ?? null),
      param(measured?.materialCount ?? null),
      param(measured?.meshCount ?? null),
      param(toJson(bbox)),
      param(toJson(input.quality ?? null)),
      ts, ts,
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

/**
 * The full version chain for a model, newest first.
 *
 * Walks `replaces_id` in both directions from the given id, so asking about
 * any version in the chain returns the whole history — a business looking at
 * v2 wants to see that v3 exists just as much as that v1 does.
 */
export function listModelVersions(businessId: string, id: string): ThreeDModel[] {
  const db = getDb()
  const chain: ThreeDModel[] = []
  const seen = new Set<string>()

  // Backwards: this model and everything it replaced.
  let cursor: string | null = id
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const row = db
      .prepare(`SELECT * FROM three_d_models WHERE id = ? AND business_id = ?`)
      .get(cursor, businessId) as Row | undefined
    if (!row) break
    chain.push(mapModel(row))
    cursor = strOrNull(row, 'replaces_id')
  }

  // Forwards: everything that replaced this model.
  cursor = id
  while (cursor) {
    const row = db
      .prepare(`SELECT * FROM three_d_models WHERE replaces_id = ? AND business_id = ?`)
      .get(cursor, businessId) as Row | undefined
    if (!row) break
    const next = str(row, 'id')
    if (seen.has(next)) break
    seen.add(next)
    chain.push(mapModel(row))
    cursor = next
  }

  return chain.sort((a, b) => b.version - a.version)
}

/** Stores a freshly computed quality report against a model. */
export function saveModelQuality(
  businessId: string,
  id: string,
  quality: QualityReport,
): void {
  const m = quality.measured
  getDb()
    .prepare(
      `UPDATE three_d_models
          SET quality = ?, triangle_count = ?, texture_bytes = ?, material_count = ?,
              mesh_count = ?, bbox = ?, file_size_bytes = ?, updated_at = ?
        WHERE id = ? AND business_id = ?`,
    )
    .run(
      toJson(quality),
      m.triangleCount,
      m.textureBytes,
      m.materialCount,
      m.meshCount,
      param(toJson(m.size)),
      m.fileBytes,
      now(),
      id,
      businessId,
    )
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
  const timestamp = now()
  const row = db
    .prepare(
      `SELECT p.* FROM products p
         JOIN businesses b ON b.id = p.business_id
        WHERE b.slug = ? AND p.slug = ?
          AND ${VISIBLE_NOW}
          AND b.deleted_at IS NULL
          AND b.status = 'active'`,
    )
    .get(businessSlug, productSlug, timestamp, timestamp) as Row | undefined

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
  const timestamp = now()
  const rows = getDb()
    .prepare(
      `SELECT p.* FROM products p
         JOIN businesses b ON b.id = p.business_id
        WHERE b.slug = ? AND ${VISIBLE_NOW}
          AND b.deleted_at IS NULL AND b.status = 'active'
        ORDER BY p.sort_order ASC, p.created_at DESC`,
    )
    .all(businessSlug, timestamp, timestamp) as Row[]
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
      param(fromBool(input.arEnabled ?? true)), input.ctaLabel ?? null, input.ctaUrl ?? null,
      input.status ?? 'draft', param(fromBool(input.isFeatured)), param(fromBool(input.isBestseller)),
      param(fromBool(input.isAvailable ?? true)), input.diet ?? null,
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
