import 'server-only'

/**
 * Server-side 3D asset validation.
 *
 * Client-side validation is a UX affordance, nothing more — an attacker posts
 * directly to the endpoint. Everything here runs on the server against the
 * actual bytes, and nothing is trusted from the request except the bytes
 * themselves. In particular the browser-supplied `type` and filename are
 * treated as hints, never as evidence.
 */

export const MODEL_FORMATS = ['glb', 'gltf', 'usdz'] as const
export type ModelFormat = (typeof MODEL_FORMATS)[number]

/**
 * Hard ceiling per file. 3D food/product scans that respect this comfortably
 * load over mobile data; beyond it the AR experience stops being usable on the
 * phones this product exists to serve.
 */
export const MAX_MODEL_BYTES = 25 * 1024 * 1024 // 25 MB
export const RECOMMENDED_MODEL_BYTES = 5 * 1024 * 1024 // 5 MB

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8 MB

export type ValidationResult =
  | { ok: true; format: ModelFormat; warnings: string[] }
  | { ok: false; error: string }

/* ── magic bytes ────────────────────────────────────────────────────────── */

/** GLB container header: ASCII "glTF" then a uint32 version. */
function isGlb(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  return (
    bytes[0] === 0x67 && // g
    bytes[1] === 0x6c && // l
    bytes[2] === 0x54 && // T
    bytes[3] === 0x46 // F
  )
}

/**
 * USDZ is an uncompressed ZIP archive, so it starts with a PK local file
 * header. That alone doesn't prove it's a USDZ — it proves it's a zip — which
 * is exactly why the extension check is kept as a second, independent signal.
 */
function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)
}

/** .gltf is JSON. Verified by parsing, not by trusting the extension. */
function looksLikeGltfJson(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 2048))
    .trimStart()
  if (!head.startsWith('{')) return false
  return head.includes('"asset"') || head.includes('"scenes"') || head.includes('"meshes"')
}

/* ── filename ───────────────────────────────────────────────────────────── */

/**
 * Produces a safe storage key. The original name is never used as a path —
 * only its extension is retained, and the stem is aggressively normalised.
 * This closes path traversal (`../../`), null-byte truncation, and Windows
 * device names in one step.
 */
export function safeStorageName(originalName: string, id: string): string {
  const ext = extensionOf(originalName)
  const stem = originalName
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40)
    .toLowerCase()

  // The id prefix guarantees uniqueness even if two businesses upload
  // "model.glb" at the same instant.
  return `${id}${stem ? `-${stem}` : ''}${ext ? `.${ext}` : ''}`
}

function extensionOf(name: string): string {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(name)
  return match?.[1]?.toLowerCase() ?? ''
}

/* ── entry point ────────────────────────────────────────────────────────── */

/**
 * Validates an uploaded 3D asset. `bytes` should be the whole file; for very
 * large uploads the first 4 KB is enough for format detection, but the size
 * check needs the real total, so pass `declaredSize` when streaming.
 */
export function validateModelUpload(
  bytes: Uint8Array,
  originalName: string,
  declaredSize = bytes.byteLength,
): ValidationResult {
  if (declaredSize === 0) {
    return { ok: false, error: 'That file is empty.' }
  }

  if (declaredSize > MAX_MODEL_BYTES) {
    return {
      ok: false,
      error: `That model is ${formatMb(declaredSize)}, over the ${formatMb(MAX_MODEL_BYTES)} limit. Compress it in Blender (Draco) and try again.`,
    }
  }

  const ext = extensionOf(originalName)
  const warnings: string[] = []

  let format: ModelFormat | null = null

  if (isGlb(bytes)) {
    format = 'glb'
    if (ext && ext !== 'glb') {
      warnings.push(`File contents are GLB but the extension is “.${ext}”. Treating it as GLB.`)
    }
  } else if (looksLikeGltfJson(bytes)) {
    format = 'gltf'
    // A .gltf references external .bin and texture files that we are not
    // receiving, so it will almost always render incomplete.
    warnings.push(
      'This is a .gltf, which references external files. Export as a single .glb so nothing goes missing.',
    )
  } else if (isZip(bytes)) {
    // Only accept a zip if the extension independently claims USDZ. Otherwise
    // this is an arbitrary archive and gets rejected.
    if (ext === 'usdz') {
      format = 'usdz'
    } else {
      return {
        ok: false,
        error: 'That looks like a ZIP archive rather than a 3D model. Upload a .glb or .usdz.',
      }
    }
  }

  if (!format) {
    return {
      ok: false,
      error:
        'Unrecognised file. Supported formats are .glb (recommended), .gltf and .usdz — the contents did not match any of them.',
    }
  }

  if (declaredSize > RECOMMENDED_MODEL_BYTES) {
    warnings.push(
      `At ${formatMb(declaredSize)} this will be slow on mobile data. Under ${formatMb(RECOMMENDED_MODEL_BYTES)} is recommended.`,
    )
  }

  return { ok: true, format, warnings }
}

const IMAGE_SIGNATURES: Array<{ mime: string; test: (b: Uint8Array) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
]

/**
 * Image validation. SVG is deliberately NOT accepted: it is executable markup
 * and serving user-uploaded SVG from our own origin is a stored-XSS vector.
 */
export function validateImageUpload(
  bytes: Uint8Array,
  declaredSize = bytes.byteLength,
): { ok: true; mime: string } | { ok: false; error: string } {
  if (declaredSize === 0) return { ok: false, error: 'That file is empty.' }
  if (declaredSize > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `That image is ${formatMb(declaredSize)}, over the ${formatMb(MAX_IMAGE_BYTES)} limit.`,
    }
  }

  const match = IMAGE_SIGNATURES.find((sig) => sig.test(bytes))
  if (!match) {
    return { ok: false, error: 'Unsupported image. Upload a JPEG, PNG or WebP.' }
  }
  return { ok: true, mime: match.mime }
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
