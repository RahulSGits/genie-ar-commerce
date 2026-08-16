import 'server-only'

import { getDb, type Row, str, strOrNull, num } from '@/lib/db'

/**
 * Cross-entity dashboard search (§53).
 *
 * Filtering happens in SQL with LIMIT, not by loading each table and filtering
 * in JavaScript. A business with 800 products and 2,000 QR codes is the case
 * this has to survive, and "load everything, then filter" is the version that
 * looks fine against seed data and falls over on the first real customer.
 *
 * Every query is scoped by business_id in its WHERE clause rather than by
 * discarding foreign rows afterwards — the same rule as every other tenant
 * read in the codebase.
 */

export type SearchKind = 'product' | 'campaign' | 'collection' | 'qr' | 'model'

export const SEARCH_KINDS: SearchKind[] = ['product', 'campaign', 'collection', 'qr', 'model']

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  product: 'Product',
  campaign: 'Campaign',
  collection: 'Collection',
  qr: 'QR code',
  model: '3D model',
}

export type SearchHit = {
  kind: SearchKind
  id: string
  title: string
  subtitle: string | null
  href: string
}

export type SearchResults = {
  hits: SearchHit[]
  /** True when at least one kind had more rows than fitted in the page. */
  truncated: boolean
}

/**
 * Escapes LIKE wildcards in user input.
 *
 * Without this, searching for "50%" matches every row, because `%` is a
 * wildcard — the pattern collapses to "match anything". It looks harmless and
 * it makes search appear broken exactly when someone types a discount into it.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

type KindQuery = {
  sql: string
  map: (row: Row) => Omit<SearchHit, 'kind'>
}

/**
 * One query per kind. Each takes exactly (businessId, prefix, contains…, limit)
 * so the runner stays trivial and there is no positional-parameter puzzle to
 * get wrong later.
 *
 * `rank` puts prefix matches first: someone typing "marg" wants Margherita
 * above "Extra Large Margherita", and a plain LIKE cannot express that.
 */
const QUERIES: Record<SearchKind, KindQuery> = {
  product: {
    sql: `SELECT id, name, sku, status,
                 CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS rank
            FROM products
           WHERE business_id = ? AND deleted_at IS NULL
             AND (name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')
           ORDER BY rank, name LIMIT ?`,
    map: (row) => ({
      id: str(row, 'id'),
      title: str(row, 'name'),
      subtitle: strOrNull(row, 'sku') ?? str(row, 'status'),
      href: `/dashboard/products/${str(row, 'id')}`,
    }),
  },
  campaign: {
    sql: `SELECT id, name, slug, status,
                 CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS rank
            FROM campaigns
           WHERE business_id = ? AND deleted_at IS NULL
             AND (name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')
           ORDER BY rank, name LIMIT ?`,
    map: (row) => ({
      id: str(row, 'id'),
      title: str(row, 'name'),
      subtitle: str(row, 'status'),
      href: `/dashboard/campaigns/${str(row, 'id')}`,
    }),
  },
  collection: {
    sql: `SELECT id, name, slug,
                 CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS rank
            FROM collections
           WHERE business_id = ? AND deleted_at IS NULL
             AND (name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')
           ORDER BY rank, name LIMIT ?`,
    map: (row) => ({
      id: str(row, 'id'),
      title: str(row, 'name'),
      subtitle: 'Collection',
      href: `/dashboard/collections`,
    }),
  },
  qr: {
    sql: `SELECT id, label, token, scan_count,
                 CASE WHEN label LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS rank
            FROM qr_codes
           WHERE business_id = ? AND deleted_at IS NULL
             AND (label LIKE ? ESCAPE '\\' OR token LIKE ? ESCAPE '\\')
           ORDER BY rank, label LIMIT ?`,
    map: (row) => ({
      id: str(row, 'id'),
      title: str(row, 'label') || str(row, 'token'),
      subtitle: `${num(row, 'scan_count').toLocaleString()} scans`,
      href: `/dashboard/qr`,
    }),
  },
  model: {
    sql: `SELECT id, name, status,
                 CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS rank
            FROM three_d_models
           WHERE business_id = ? AND deleted_at IS NULL
             AND (name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')
           ORDER BY rank, name LIMIT ?`,
    map: (row) => ({
      id: str(row, 'id'),
      title: str(row, 'name'),
      subtitle: str(row, 'status'),
      href: `/dashboard/models`,
    }),
  },
}

export function search(
  businessId: string,
  rawTerm: string,
  opts: { kinds?: SearchKind[]; perKind?: number } = {},
): SearchResults {
  const term = rawTerm.trim()
  // One character matches most of the catalogue and helps nobody.
  if (term.length < 2) return { hits: [], truncated: false }

  const perKind = Math.min(Math.max(opts.perKind ?? 5, 1), 50)
  const kinds = opts.kinds?.length ? opts.kinds : SEARCH_KINDS
  const escaped = escapeLike(term)
  const prefix = `${escaped}%`
  const contains = `%${escaped}%`

  const db = getDb()
  const hits: SearchHit[] = []
  let truncated = false

  for (const kind of kinds) {
    const query = QUERIES[kind]
    // Ask for one extra row: if it comes back, there is more behind the page.
    const rows = db
      .prepare(query.sql)
      .all(prefix, businessId, contains, contains, perKind + 1) as Row[]

    if (rows.length > perKind) {
      truncated = true
      rows.length = perKind
    }
    for (const row of rows) hits.push({ kind, ...query.map(row) })
  }

  return { hits, truncated }
}
