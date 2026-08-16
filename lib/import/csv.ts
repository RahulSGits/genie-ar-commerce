/**
 * CSV import and export (§46).
 *
 * Solves a concrete onboarding problem: a furniture retailer with 600 SKUs is
 * not going to type them into a wizard one at a time, and if the only way in is
 * the wizard then the deal does not close.
 *
 * No `server-only` — the parser is pure and is unit-tested directly, and the
 * preview table runs the same code the commit does, so what the user approves
 * is exactly what gets written.
 */

/* ── parsing ────────────────────────────────────────────────────────────── */

/**
 * RFC 4180 parser, written out rather than `split(',')`.
 *
 * Splitting on commas breaks on the first product called "Chair, Oak" and on
 * every description containing a comma — which is most of them. Quoted fields,
 * escaped quotes (`""`) and newlines inside quotes all have to work or the
 * import silently shifts every column to the right from that row onward.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // A byte-order mark survives Excel's "Save as CSV" and would otherwise
  // become part of the first header name, so nothing maps to `name`.
  if (text.charCodeAt(0) === 0xfeff) i = 1

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (char === '\r') {
      i += 1
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += char
    i += 1
  }

  // Trailing field, unless the file ended on a clean newline.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null || cell === undefined ? '' : String(cell)
          // Quote when the value contains a delimiter, a quote or a newline.
          // A leading =, +, - or @ is quoted too: Excel executes those as
          // formulas, which turns an exported product name into CSV injection.
          const risky = /[",\n\r]/.test(value)
          const formula = /^[=+\-@\t]/.test(value)
          if (!risky && !formula) return value
          return `"${(formula ? `'${value}` : value).replace(/"/g, '""')}"`
        })
        .join(','),
    )
    .join('\r\n')
}

/* ── the product import shape ───────────────────────────────────────────── */

export const IMPORT_COLUMNS = [
  'name',
  'sku',
  'price',
  'description',
  'category',
  'image_url',
  'brand',
  'tags',
  'width_cm',
  'height_cm',
  'depth_cm',
] as const

export type ImportColumn = (typeof IMPORT_COLUMNS)[number]

export const REQUIRED_COLUMNS: ImportColumn[] = ['name']

export const COLUMN_HELP: Record<ImportColumn, string> = {
  name: 'Required. The product name.',
  sku: 'Your own product code. Used to match existing products on re-import.',
  price: 'A number, e.g. 349 or 349.50. Currency comes from your workspace.',
  description: 'Free text.',
  category: 'Matched by name; created if it does not exist.',
  image_url: 'A public https URL to the product photo.',
  brand: 'Free text.',
  tags: 'Separated by semicolons, e.g. spicy;popular',
  width_cm: 'Real-world width in centimetres. Drives AR scale.',
  height_cm: 'Real-world height in centimetres.',
  depth_cm: 'Real-world depth in centimetres.',
}

export type ParsedRow = {
  /** 1-based line number in the uploaded file, for error messages. */
  line: number
  name: string
  sku: string | null
  priceMinor: number | null
  description: string | null
  category: string | null
  imageUrl: string | null
  brand: string | null
  tags: string[]
  dimWidth: number | null
  dimHeight: number | null
  dimDepth: number | null
}

export type RowError = { line: number; column: string; message: string }

export type ImportPreview = {
  rows: ParsedRow[]
  errors: RowError[]
  /** Header names present in the file that GENIE does not use. */
  unknownColumns: string[]
  missingRequired: string[]
  totalLines: number
}

/** Normalises a header cell: "Image URL" and "image_url" are the same column. */
function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function previewImport(text: string, maxRows = 1000): ImportPreview {
  const table = parseCsv(text)
  const headerRow = table[0]

  if (!headerRow) {
    return {
      rows: [],
      errors: [{ line: 1, column: '', message: 'The file is empty.' }],
      unknownColumns: [],
      missingRequired: [...REQUIRED_COLUMNS],
      totalLines: 0,
    }
  }

  const headers = headerRow.map(normaliseHeader)
  const index = new Map<string, number>()
  headers.forEach((header, i) => {
    if (!index.has(header)) index.set(header, i)
  })

  const known = new Set<string>(IMPORT_COLUMNS)
  const unknownColumns = headers.filter((h) => h !== '' && !known.has(h))
  const missingRequired = REQUIRED_COLUMNS.filter((c) => !index.has(c))

  const rows: ParsedRow[] = []
  const errors: RowError[] = []

  if (missingRequired.length > 0) {
    return { rows, errors, unknownColumns, missingRequired, totalLines: table.length - 1 }
  }

  const cell = (row: string[], column: ImportColumn): string => {
    const at = index.get(column)
    return at === undefined ? '' : (row[at] ?? '').trim()
  }

  const seenSkus = new Set<string>()

  for (let r = 1; r < table.length && rows.length < maxRows; r++) {
    const row = table[r]
    if (!row) continue
    const line = r + 1

    const name = cell(row, 'name')
    if (name === '') {
      errors.push({ line, column: 'name', message: 'Name is required.' })
      continue
    }

    const sku = cell(row, 'sku') || null
    if (sku && seenSkus.has(sku.toLowerCase())) {
      // Duplicates inside one file would import as two products with the same
      // code, which then makes every future re-import ambiguous.
      errors.push({ line, column: 'sku', message: `Duplicate SKU "${sku}" in this file.` })
      continue
    }
    if (sku) seenSkus.add(sku.toLowerCase())

    const priceText = cell(row, 'price')
    let priceMinor: number | null = null
    if (priceText !== '') {
      // Strip currency symbols and thousands separators before parsing —
      // "₹1,299.00" is what a real export contains.
      const cleaned = priceText.replace(/[^\d.-]/g, '')
      const value = Number(cleaned)
      if (!Number.isFinite(value) || value < 0) {
        errors.push({ line, column: 'price', message: `"${priceText}" is not a valid price.` })
        continue
      }
      // Round rather than truncate: 349.999 should be ₹350.00, not ₹349.99.
      priceMinor = Math.round(value * 100)
    }

    const imageUrl = cell(row, 'image_url') || null
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      errors.push({
        line,
        column: 'image_url',
        message: 'Must be a full URL starting with https://',
      })
      continue
    }

    rows.push({
      line,
      name,
      sku,
      priceMinor,
      description: cell(row, 'description') || null,
      category: cell(row, 'category') || null,
      imageUrl,
      brand: cell(row, 'brand') || null,
      tags: cell(row, 'tags')
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean),
      dimWidth: numberOrNull(cell(row, 'width_cm')),
      dimHeight: numberOrNull(cell(row, 'height_cm')),
      dimDepth: numberOrNull(cell(row, 'depth_cm')),
    })
  }

  const skipped = table.length - 1 - rows.length - errors.length
  if (skipped > 0) {
    errors.push({
      line: 0,
      column: '',
      message: `${skipped} further row${skipped === 1 ? ' was' : 's were'} not read — the limit is ${maxRows} per import.`,
    })
  }

  return { rows, errors, unknownColumns, missingRequired, totalLines: table.length - 1 }
}

function numberOrNull(value: string): number | null {
  if (value === '') return null
  const parsed = Number(value.replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** The template a customer downloads before filling it in. */
export function importTemplateCsv(): string {
  return toCsv([
    [...IMPORT_COLUMNS],
    [
      'Margherita Pizza',
      'PZ-001',
      '349',
      'San Marzano tomatoes, fior di latte, basil',
      'Pizza',
      'https://example.com/margherita.jpg',
      '',
      'vegetarian;popular',
      '30',
      '4',
      '30',
    ],
  ])
}
