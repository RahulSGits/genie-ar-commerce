/**
 * 3D Readiness Score.
 *
 * Every number here comes from `inspectGlb`, which reads the actual file. When
 * something genuinely cannot be determined from a glTF — printability needs
 * manifold geometry, which the format does not declare — the check reports
 * `unknown` and is EXCLUDED from the weighted average rather than counted as a
 * pass. A score that quietly rounds "don't know" up to "fine" is the exact
 * failure mode this whole module exists to avoid.
 */

import { inspectGlb, GlbParseError, type GlbInspection, type Vec3 } from '@/lib/quality/gltf'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export type QualityCheck = {
  id: string
  label: string
  status: CheckStatus
  /** Rendered next to the label, e.g. "48,220 triangles". */
  detail: string
  /** Only when actionable. Absent on a pass. */
  advice?: string
}

export type QualityReport = {
  /** 0–100. Weighted over checks that could actually be evaluated. */
  modelQuality: number
  mobilePerformance: number
  arReady: boolean
  webReady: boolean
  /** Null when undeterminable — rendered as "Unknown", never as "No". */
  printReady: boolean | null
  checks: QualityCheck[]
  measured: {
    fileBytes: number
    triangleCount: number
    textureBytes: number
    materialCount: number
    meshCount: number
    size: Vec3 | null
  }
  /** Set when the file could not be parsed at all. */
  error?: string
  /** ISO timestamp — a score is only true of the file it was run against. */
  scoredAt: string
}

/* ── budgets ────────────────────────────────────────────────────────────── */

/**
 * Thresholds for a model that will be downloaded over mobile data and rendered
 * on a mid-range phone, which is the actual delivery context for a QR scan at
 * a restaurant table. They are deliberately stricter than desktop-web budgets.
 */
export const BUDGETS = {
  fileBytes: { good: 5_000_000, warn: 15_000_000 },
  triangles: { good: 100_000, warn: 250_000 },
  textureBytes: { good: 4_000_000, warn: 12_000_000 },
  /** Below this a "3D model" is a flat card or an empty scene. */
  minTriangles: 100,
  /** Plausible real-world extent in metres, largest axis. */
  size: { min: 0.01, max: 20 },
  /** Triangle density that makes a mesh worth sending to a 3D printer. */
  printTriangles: 50_000,
} as const

const WEIGHTS: Record<string, number> = {
  geometry: 3,
  normals: 2,
  uvs: 1,
  materials: 2,
  textures: 1,
  scale: 3,
}

const PERF_WEIGHTS: Record<string, number> = {
  file_size: 3,
  triangle_budget: 2,
  texture_budget: 2,
  draw_calls: 1,
}

/* ── entry point ────────────────────────────────────────────────────────── */

export function scoreGlb(bytes: Uint8Array): QualityReport {
  let inspection: GlbInspection
  try {
    inspection = inspectGlb(bytes)
  } catch (err) {
    const message =
      err instanceof GlbParseError ? err.message : 'The file could not be read as a GLB.'
    return {
      modelQuality: 0,
      mobilePerformance: 0,
      arReady: false,
      webReady: false,
      printReady: null,
      checks: [
        {
          id: 'integrity',
          label: 'File integrity',
          status: 'fail',
          detail: message,
          advice: 'Re-export as binary glTF (.glb) version 2.',
        },
      ],
      measured: {
        fileBytes: bytes.byteLength,
        triangleCount: 0,
        textureBytes: 0,
        materialCount: 0,
        meshCount: 0,
        size: null,
      },
      error: message,
      scoredAt: new Date().toISOString(),
    }
  }

  return scoreInspection(inspection)
}

export function scoreInspection(m: GlbInspection): QualityReport {
  const quality: QualityCheck[] = []
  const performance: QualityCheck[] = []

  /* ── quality ─────────────────────────────────────────────────────────── */

  quality.push({
    id: 'integrity',
    label: 'File integrity',
    status: 'pass',
    detail: `Valid binary glTF 2.0, ${formatBytes(m.fileBytes)}`,
  })

  quality.push(
    m.triangleCount >= BUDGETS.minTriangles
      ? {
          id: 'geometry',
          label: 'Geometry',
          status: 'pass',
          detail: `${m.triangleCount.toLocaleString()} triangles across ${m.meshCount} mesh${m.meshCount === 1 ? '' : 'es'}`,
        }
      : {
          id: 'geometry',
          label: 'Geometry',
          status: 'fail',
          detail:
            m.triangleCount === 0
              ? 'No triangle geometry'
              : `Only ${m.triangleCount.toLocaleString()} triangles`,
          advice: 'This is too sparse to read as a solid object in AR.',
        },
  )

  quality.push(
    m.hasNormals
      ? { id: 'normals', label: 'Surface normals', status: 'pass', detail: 'Present' }
      : {
          id: 'normals',
          label: 'Surface normals',
          status: 'warn',
          detail: 'Missing',
          advice: 'Lighting falls back to flat shading, so the model looks papery in AR.',
        },
  )

  quality.push(
    m.hasUvs
      ? { id: 'uvs', label: 'Texture coordinates', status: 'pass', detail: 'Present' }
      : {
          id: 'uvs',
          label: 'Texture coordinates',
          status: m.imageCount > 0 ? 'fail' : 'warn',
          detail: m.imageCount > 0 ? 'Missing, but textures are present' : 'Missing',
          advice:
            m.imageCount > 0
              ? 'Textures cannot be applied without UVs — the model will render untextured.'
              : 'Only needed if you intend to texture this model.',
        },
  )

  quality.push(
    m.materialCount > 0
      ? {
          id: 'materials',
          label: 'Materials',
          status: 'pass',
          detail: `${m.materialCount} material${m.materialCount === 1 ? '' : 's'}`,
        }
      : {
          id: 'materials',
          label: 'Materials',
          status: 'fail',
          detail: 'None',
          advice: 'The viewer will fall back to plain grey.',
        },
  )

  if (m.externalImageCount > 0) {
    quality.push({
      id: 'textures',
      label: 'Textures',
      status: 'fail',
      detail: `${m.externalImageCount} image${m.externalImageCount === 1 ? '' : 's'} referenced by URL`,
      advice: 'External images will not load from a QR page. Re-export with textures embedded.',
    })
  } else if (m.imageCount > 0) {
    quality.push({
      id: 'textures',
      label: 'Textures',
      status: 'pass',
      detail: `${m.imageCount} embedded, ${formatBytes(m.textureBytes)}`,
    })
  } else {
    quality.push({
      id: 'textures',
      label: 'Textures',
      status: 'warn',
      detail: 'None — colour comes from materials only',
    })
  }

  const largest = m.size ? Math.max(m.size.x, m.size.y, m.size.z) : null
  quality.push(scaleCheck(m.size, largest))

  /* ── performance ─────────────────────────────────────────────────────── */

  performance.push(
    band('file_size', 'Download size', m.fileBytes, BUDGETS.fileBytes, formatBytes, {
      warn: 'Slow to load over mobile data at a table.',
      fail: 'Most customers will abandon before this finishes downloading.',
    }),
  )

  performance.push(
    band(
      'triangle_budget',
      'Triangle budget',
      m.triangleCount,
      BUDGETS.triangles,
      (n) => `${n.toLocaleString()} triangles`,
      {
        warn: 'Heavy for older phones; expect a lower frame rate in AR.',
        fail: 'Likely to stutter or fail to render on mid-range devices.',
      },
    ),
  )

  performance.push(
    band('texture_budget', 'Texture memory', m.textureBytes, BUDGETS.textureBytes, formatBytes, {
      warn: 'Large textures dominate memory on mobile.',
      fail: 'Very likely to be downscaled or dropped by the browser.',
    }),
  )

  // Each mesh is at minimum one draw call; many small meshes cost more than
  // one large one at identical triangle counts.
  performance.push(
    m.meshCount <= 20
      ? {
          id: 'draw_calls',
          label: 'Mesh count',
          status: 'pass',
          detail: `${m.meshCount} mesh${m.meshCount === 1 ? '' : 'es'}`,
        }
      : {
          id: 'draw_calls',
          label: 'Mesh count',
          status: m.meshCount <= 60 ? 'warn' : 'fail',
          detail: `${m.meshCount} meshes`,
          advice: 'Merge meshes that share a material to cut draw calls.',
        },
  )

  if (m.compressed) {
    performance.push({
      id: 'compression',
      label: 'Compression',
      status: 'pass',
      detail: m.extensions.filter((e) => e.includes('draco') || e.includes('meshopt') || e.includes('basisu')).join(', ') || 'Enabled',
    })
  }

  /* ── verdicts ────────────────────────────────────────────────────────── */

  const modelQuality = weightedScore(quality, WEIGHTS)
  const mobilePerformance = weightedScore(performance, PERF_WEIGHTS)

  // AR is a hard gate, not a score: the model must have real geometry, real
  // materials, and a size a phone can place in a room. A 78% that still puts a
  // 40-metre burger on someone's table is not a pass.
  const arReady =
    m.triangleCount >= BUDGETS.minTriangles &&
    m.materialCount > 0 &&
    m.externalImageCount === 0 &&
    largest !== null &&
    largest >= BUDGETS.size.min &&
    largest <= BUDGETS.size.max

  const webReady = m.fileBytes <= BUDGETS.fileBytes.warn && m.triangleCount >= BUDGETS.minTriangles

  // glTF carries no manifold/watertight declaration and nothing here decodes
  // vertices, so a definite "yes" is not available. High-density geometry is
  // reported as a maybe; everything else is honestly unknown.
  const printReady = m.triangleCount === 0 ? false : m.triangleCount >= BUDGETS.printTriangles ? null : false

  return {
    modelQuality,
    mobilePerformance,
    arReady,
    webReady,
    printReady,
    checks: [...quality, ...performance],
    measured: {
      fileBytes: m.fileBytes,
      triangleCount: m.triangleCount,
      textureBytes: m.textureBytes,
      materialCount: m.materialCount,
      meshCount: m.meshCount,
      size: m.size,
    },
    scoredAt: new Date().toISOString(),
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

function scaleCheck(size: Vec3 | null, largest: number | null): QualityCheck {
  if (!size || largest === null) {
    return {
      id: 'scale',
      label: 'Real-world scale',
      status: 'unknown',
      detail: 'Bounds not declared in the file',
      advice: 'AR will place this at a default size rather than its true size.',
    }
  }
  const dims = `${cm(size.x)} × ${cm(size.y)} × ${cm(size.z)} cm`

  if (largest < BUDGETS.size.min) {
    return {
      id: 'scale',
      label: 'Real-world scale',
      status: 'fail',
      detail: `${dims} — smaller than a centimetre`,
      advice: 'glTF units are metres. Re-export at real-world scale or set the scale multiplier.',
    }
  }
  if (largest > BUDGETS.size.max) {
    return {
      id: 'scale',
      label: 'Real-world scale',
      status: 'fail',
      detail: `${dims} — over ${BUDGETS.size.max} m across`,
      advice: 'This will not fit in a room. Re-export at real-world scale in metres.',
    }
  }
  return { id: 'scale', label: 'Real-world scale', status: 'pass', detail: dims }
}

function band(
  id: string,
  label: string,
  value: number,
  budget: { good: number; warn: number },
  format: (n: number) => string,
  advice: { warn: string; fail: string },
): QualityCheck {
  if (value <= budget.good) return { id, label, status: 'pass', detail: format(value) }
  if (value <= budget.warn) {
    return { id, label, status: 'warn', detail: format(value), advice: advice.warn }
  }
  return { id, label, status: 'fail', detail: format(value), advice: advice.fail }
}

const STATUS_POINTS: Record<Exclude<CheckStatus, 'unknown'>, number> = {
  pass: 1,
  warn: 0.5,
  fail: 0,
}

/**
 * Weighted average over evaluable checks only.
 *
 * `unknown` checks are dropped from both numerator and denominator. Scoring
 * them as 0 would punish a business for a limitation of the file format;
 * scoring them as 1 would be a lie.
 */
function weightedScore(checks: QualityCheck[], weights: Record<string, number>): number {
  let earned = 0
  let possible = 0
  for (const check of checks) {
    if (check.status === 'unknown') continue
    const weight = weights[check.id] ?? 1
    possible += weight
    earned += weight * STATUS_POINTS[check.status]
  }
  if (possible === 0) return 0
  return Math.round((earned / possible) * 100)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function cm(metres: number): string {
  return (metres * 100).toFixed(1)
}
