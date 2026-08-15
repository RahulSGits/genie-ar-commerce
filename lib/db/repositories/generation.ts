import 'server-only'

import {
  getDb, now, uuid, parseJson, toJson, str, strOrNull, num, numOrNull, param,
  transaction, type Row, type SqlParam,
} from '@/lib/db'
import type { GenerationStage, GenerationStatus } from '@/lib/ai3d/provider'
import type { Product, ThreeDModel } from '@/types/domain'

/**
 * Generation jobs, product images and collections.
 *
 * A job is a durable record rather than in-memory state: reconstruction takes
 * minutes, the browser may close mid-run, and a failure has to be explainable
 * afterwards. Only the server advances `stage` — the client renders what it is
 * told and never invents progress.
 */

export type GenerationJob = {
  id: string
  businessId: string
  productId: string | null
  modelId: string | null
  provider: string
  providerJobId: string | null
  status: GenerationStatus
  stage: GenerationStage
  progress: number | null
  errorCode: string | null
  errorMessage: string | null
  input: { imageIds?: string[]; options?: Record<string, unknown> } | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  productName?: string | null
}

function mapJob(row: Row): GenerationJob {
  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    productId: strOrNull(row, 'product_id'),
    modelId: strOrNull(row, 'model_id'),
    provider: str(row, 'provider') || 'none',
    providerJobId: strOrNull(row, 'provider_job_id'),
    status: (str(row, 'status') || 'queued') as GenerationStatus,
    stage: (str(row, 'stage') || 'uploading') as GenerationStage,
    progress: numOrNull(row, 'progress'),
    errorCode: strOrNull(row, 'error_code'),
    errorMessage: strOrNull(row, 'error_message'),
    input: parseJson<GenerationJob['input']>(row.input, null),
    startedAt: strOrNull(row, 'started_at'),
    finishedAt: strOrNull(row, 'finished_at'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
    productName: strOrNull(row, 'product_name'),
  }
}

export function createJob(input: {
  businessId: string
  productId?: string | null
  provider: string
  imageIds: string[]
}): string {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO generation_jobs
         (id, business_id, product_id, provider, status, stage, input, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', 'uploading', ?, ?, ?)`,
    )
    .run(
      id, input.businessId, input.productId ?? null, input.provider,
      toJson({ imageIds: input.imageIds }), ts, ts,
    )
  return id
}

export function getJob(businessId: string, id: string): GenerationJob | null {
  const row = getDb()
    .prepare(
      `SELECT j.*, p.name AS product_name
         FROM generation_jobs j
         LEFT JOIN products p ON p.id = j.product_id
        WHERE j.id = ? AND j.business_id = ?`,
    )
    .get(id, businessId) as Row | undefined
  return row ? mapJob(row) : null
}

export function listJobs(businessId: string, limit = 25): GenerationJob[] {
  const rows = getDb()
    .prepare(
      `SELECT j.*, p.name AS product_name
         FROM generation_jobs j
         LEFT JOIN products p ON p.id = j.product_id
        WHERE j.business_id = ?
        ORDER BY j.created_at DESC LIMIT ?`,
    )
    .all(businessId, limit) as Row[]
  return rows.map(mapJob)
}

/** The job a product is currently waiting on, if any. */
export function getActiveJobForProduct(
  businessId: string,
  productId: string,
): GenerationJob | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM generation_jobs
        WHERE business_id = ? AND product_id = ? AND status IN ('queued','running')
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(businessId, productId) as Row | undefined
  return row ? mapJob(row) : null
}

export function updateJob(
  businessId: string,
  id: string,
  patch: Partial<{
    status: GenerationStatus
    stage: GenerationStage
    progress: number | null
    providerJobId: string | null
    modelId: string | null
    errorCode: string | null
    errorMessage: string | null
    startedAt: string | null
    finishedAt: string | null
  }>,
): void {
  const map: Record<string, string> = {
    status: 'status', stage: 'stage', progress: 'progress',
    providerJobId: 'provider_job_id', modelId: 'model_id',
    errorCode: 'error_code', errorMessage: 'error_message',
    startedAt: 'started_at', finishedAt: 'finished_at',
  }
  const sets: string[] = []
  const params: SqlParam[] = []
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k]
    if (!col) continue
    sets.push(`${col} = ?`)
    params.push(param(v))
  }
  if (!sets.length) return
  sets.push('updated_at = ?')
  params.push(now(), id, businessId)
  getDb()
    .prepare(`UPDATE generation_jobs SET ${sets.join(', ')} WHERE id = ? AND business_id = ?`)
    .run(...params)
}

/**
 * Marks a job failed. Always records a reason — a job that stops with no
 * explanation is the single most frustrating state for a user to land in.
 */
export function failJob(
  businessId: string,
  id: string,
  code: string,
  message: string,
): void {
  updateJob(businessId, id, {
    status: 'failed',
    errorCode: code,
    errorMessage: message,
    finishedAt: now(),
  })
}

/* ── product images ─────────────────────────────────────────────────────── */

export type ProductImage = {
  id: string
  businessId: string
  productId: string | null
  url: string
  bytes: number
  mime: string | null
  role: 'primary' | 'angle' | 'reference'
  sortOrder: number
  createdAt: string
}

function mapImage(row: Row): ProductImage {
  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    productId: strOrNull(row, 'product_id'),
    url: str(row, 'url'),
    bytes: num(row, 'bytes'),
    mime: strOrNull(row, 'mime'),
    role: (str(row, 'role') || 'primary') as ProductImage['role'],
    sortOrder: num(row, 'sort_order'),
    createdAt: str(row, 'created_at'),
  }
}

export function createProductImage(input: {
  businessId: string
  productId?: string | null
  url: string
  bytes: number
  mime: string
  role?: ProductImage['role']
  sortOrder?: number
}): string {
  const id = uuid()
  getDb()
    .prepare(
      `INSERT INTO product_images
         (id, business_id, product_id, url, bytes, mime, role, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, input.businessId, input.productId ?? null, input.url, input.bytes,
      input.mime, input.role ?? 'primary', input.sortOrder ?? 0, now(),
    )
  return id
}

export function listProductImages(businessId: string, productId: string): ProductImage[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM product_images
        WHERE business_id = ? AND product_id = ?
        ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(businessId, productId) as Row[]
  return rows.map(mapImage)
}

export function attachImagesToProduct(
  businessId: string,
  imageIds: string[],
  productId: string,
): void {
  const stmt = getDb().prepare(
    `UPDATE product_images SET product_id = ? WHERE id = ? AND business_id = ?`,
  )
  for (const id of imageIds) stmt.run(productId, id, businessId)
}

export function deleteProductImage(businessId: string, id: string): void {
  getDb()
    .prepare(`DELETE FROM product_images WHERE id = ? AND business_id = ?`)
    .run(id, businessId)
}

/* ── collections ────────────────────────────────────────────────────────── */

export type Collection = {
  id: string
  businessId: string
  name: string
  slug: string
  description: string | null
  coverUrl: string | null
  isPublished: boolean
  sortOrder: number
  productCount: number
}

export function listCollections(businessId: string): Collection[] {
  const rows = getDb()
    .prepare(
      `SELECT c.*, (
          SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = c.id
        ) AS product_count
         FROM collections c
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
    coverUrl: strOrNull(r, 'cover_url'),
    isPublished: num(r, 'is_published') === 1,
    sortOrder: num(r, 'sort_order'),
    productCount: num(r, 'product_count'),
  }))
}

export function getCollection(businessId: string, id: string): Collection | null {
  return listCollections(businessId).find((c) => c.id === id) ?? null
}

export function createCollection(input: {
  businessId: string
  name: string
  slug: string
  description?: string | null
}): string {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO collections (id, business_id, name, slug, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.businessId, input.name, input.slug, input.description ?? null, ts, ts)
  return id
}

export function updateCollection(
  businessId: string,
  id: string,
  patch: { name?: string; description?: string | null; isPublished?: boolean },
): void {
  const sets: string[] = []
  const params: SqlParam[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name) }
  if (patch.description !== undefined) { sets.push('description = ?'); params.push(param(patch.description)) }
  if (patch.isPublished !== undefined) { sets.push('is_published = ?'); params.push(patch.isPublished ? 1 : 0) }
  if (!sets.length) return
  sets.push('updated_at = ?')
  params.push(now(), id, businessId)
  getDb().prepare(`UPDATE collections SET ${sets.join(', ')} WHERE id = ? AND business_id = ?`).run(...params)
}

export function deleteCollection(businessId: string, id: string): void {
  getDb()
    .prepare(`UPDATE collections SET deleted_at = ? WHERE id = ? AND business_id = ?`)
    .run(now(), id, businessId)
}

/** Replaces a collection's membership wholesale — simpler than diffing. */
export function setCollectionProducts(
  businessId: string,
  collectionId: string,
  productIds: string[],
): void {
  transaction(() => {
    const db = getDb()
    // Ownership is re-checked here rather than trusted from the caller.
    const owns = db
      .prepare(`SELECT id FROM collections WHERE id = ? AND business_id = ? AND deleted_at IS NULL`)
      .get(collectionId, businessId)
    if (!owns) return

    db.prepare(`DELETE FROM collection_products WHERE collection_id = ?`).run(collectionId)

    const insert = db.prepare(
      `INSERT INTO collection_products (collection_id, product_id, sort_order)
       SELECT ?, id, ? FROM products WHERE id = ? AND business_id = ? AND deleted_at IS NULL`,
    )
    productIds.forEach((productId, i) => insert.run(collectionId, i, productId, businessId))
  })
}

export function listCollectionProducts(
  businessId: string,
  collectionId: string,
): Array<Pick<Product, 'id' | 'name' | 'slug' | 'imageUrl' | 'priceMinor' | 'currency'>> {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.name, p.slug, p.image_url, p.price_minor, p.currency
         FROM collection_products cp
         JOIN products p ON p.id = cp.product_id
        WHERE cp.collection_id = ? AND p.business_id = ? AND p.deleted_at IS NULL
        ORDER BY cp.sort_order ASC`,
    )
    .all(collectionId, businessId) as Row[]

  return rows.map((r) => ({
    id: str(r, 'id'),
    name: str(r, 'name'),
    slug: str(r, 'slug'),
    imageUrl: strOrNull(r, 'image_url'),
    priceMinor: numOrNull(r, 'price_minor'),
    currency: (str(r, 'currency') || 'INR') as Product['currency'],
  }))
}

/* ── lifecycle status ───────────────────────────────────────────────────── */

/**
 * The status GENIE shows for a product.
 *
 * Derived rather than stored. `products.status` remains the publication gate
 * (and the thing the public route filters on); readiness comes from the model
 * and any in-flight job. Storing a second status column would let the two drift
 * apart, and the drift would be invisible until a customer scanned a code.
 */
export type ProductLifecycle =
  | 'draft'
  | 'processing'
  | 'failed'
  | 'model_ready'
  | 'ar_ready'
  | 'published'
  | 'archived'

export function getProductLifecycle(
  product: Pick<Product, 'status' | 'arEnabled' | 'modelId'>,
  model: Pick<ThreeDModel, 'status'> | null,
  activeJob: Pick<GenerationJob, 'status'> | null,
): ProductLifecycle {
  if (product.status === 'archived') return 'archived'
  if (activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')) {
    return 'processing'
  }
  if (model?.status === 'failed') return 'failed'
  if (product.status === 'published') return 'published'
  if (model?.status === 'ready') {
    return product.arEnabled ? 'ar_ready' : 'model_ready'
  }
  return 'draft'
}

export const LIFECYCLE_LABELS: Record<ProductLifecycle, string> = {
  draft: 'Draft',
  processing: 'Processing',
  failed: 'Failed',
  model_ready: '3D ready',
  ar_ready: 'AR ready',
  published: 'Published',
  archived: 'Archived',
}

export const LIFECYCLE_VARIANTS: Record<
  ProductLifecycle,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'muted'
> = {
  draft: 'muted',
  processing: 'warning',
  failed: 'destructive',
  model_ready: 'secondary',
  ar_ready: 'default',
  published: 'success',
  archived: 'muted',
}
