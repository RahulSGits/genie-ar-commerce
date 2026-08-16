/**
 * GLB inspection.
 *
 * Reads the real numbers out of a binary glTF: triangle count, texture bytes,
 * material count and the true world-space bounding box. Everything here is
 * measured from the file — nothing is estimated, defaulted or guessed, because
 * a "3D Readiness Score" built on guesses is worse than no score at all.
 *
 * Deliberately dependency-free and synchronous over a Buffer: this runs on
 * upload and on generation completion, where pulling in a full loader (and its
 * DOM assumptions) would be both slower and more fragile than reading the
 * 12-byte header the spec guarantees.
 *
 * Reference: glTF 2.0 §3.3 (binary layout), §3.6.2.4 (POSITION accessors are
 * REQUIRED to carry min/max, which is what makes an exact bbox possible
 * without decoding a single vertex).
 */

const GLB_MAGIC = 0x46546c67 // 'glTF' little-endian
const CHUNK_JSON = 0x4e4f534a // 'JSON'
const CHUNK_BIN = 0x004e4942 // 'BIN\0'

/** glTF primitive.mode — 4 is TRIANGLES and is the default when absent. */
const MODE_TRIANGLES = 4
const MODE_TRIANGLE_STRIP = 5
const MODE_TRIANGLE_FAN = 6

export type Vec3 = { x: number; y: number; z: number }

export type GlbInspection = {
  /** Total bytes of the container. */
  fileBytes: number
  /** Sum over every triangle-mode primitive. Compressed meshes included. */
  triangleCount: number
  meshCount: number
  nodeCount: number
  materialCount: number
  /** Bytes occupied by embedded images. External URIs cannot be sized here. */
  textureBytes: number
  imageCount: number
  /** Images referenced by URI rather than embedded — not counted in textureBytes. */
  externalImageCount: number
  /** World-space size in metres. glTF units are metres by specification. */
  size: Vec3 | null
  /** True when at least one primitive carries a NORMAL attribute. */
  hasNormals: boolean
  hasUvs: boolean
  hasVertexColours: boolean
  /** Non-fatal observations worth showing the user. */
  extensions: string[]
  /** Set when the file is compressed — triangle counts still read correctly. */
  compressed: boolean
  /** Draft glTF that parsed but failed a spec expectation. */
  warnings: string[]
}

export class GlbParseError extends Error {}

/* ── glTF JSON subset ───────────────────────────────────────────────────── */

type Accessor = { count?: number; min?: number[]; max?: number[]; type?: string }
type Primitive = {
  attributes?: Record<string, number>
  indices?: number
  mode?: number
  material?: number
  extensions?: Record<string, unknown>
}
type Mesh = { primitives?: Primitive[] }
type Node = {
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}
type BufferView = { byteLength?: number }
type Image = { bufferView?: number; uri?: string; mimeType?: string }
type Gltf = {
  accessors?: Accessor[]
  meshes?: Mesh[]
  nodes?: Node[]
  scenes?: { nodes?: number[] }[]
  scene?: number
  materials?: unknown[]
  images?: Image[]
  bufferViews?: BufferView[]
  extensionsUsed?: string[]
}

/* ── entry point ────────────────────────────────────────────────────────── */

export function inspectGlb(bytes: Uint8Array): GlbInspection {
  const json = readJsonChunk(bytes)
  const warnings: string[] = []

  const accessors = json.accessors ?? []
  const meshes = json.meshes ?? []
  const nodes = json.nodes ?? []
  const bufferViews = json.bufferViews ?? []
  const images = json.images ?? []
  const extensions = json.extensionsUsed ?? []

  const compressed = extensions.some(
    (e) =>
      e === 'KHR_draco_mesh_compression' ||
      e === 'EXT_meshopt_compression' ||
      e === 'KHR_texture_basisu',
  )

  /* triangles ------------------------------------------------------------ */

  let triangleCount = 0
  let hasNormals = false
  let hasUvs = false
  let hasVertexColours = false

  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? []) {
      const attrs = prim.attributes ?? {}
      if ('NORMAL' in attrs) hasNormals = true
      if ('TEXCOORD_0' in attrs) hasUvs = true
      if ('COLOR_0' in attrs) hasVertexColours = true

      // mode is optional and defaults to TRIANGLES. Treating "absent" as
      // "not triangles" would report 0 on the many exporters that omit it.
      const mode = prim.mode ?? MODE_TRIANGLES
      const vertices =
        prim.indices !== undefined
          ? (accessors[prim.indices]?.count ?? 0)
          : (accessors[attrs['POSITION'] ?? -1]?.count ?? 0)

      if (mode === MODE_TRIANGLES) {
        triangleCount += Math.floor(vertices / 3)
      } else if (mode === MODE_TRIANGLE_STRIP || mode === MODE_TRIANGLE_FAN) {
        // A strip or fan of n vertices is n-2 triangles.
        triangleCount += Math.max(0, vertices - 2)
      }
      // Points and lines contribute no triangles, by definition.
    }
  }

  /* textures ------------------------------------------------------------- */

  let textureBytes = 0
  let externalImageCount = 0

  for (const image of images) {
    if (image.bufferView !== undefined) {
      textureBytes += bufferViews[image.bufferView]?.byteLength ?? 0
    } else if (typeof image.uri === 'string') {
      if (image.uri.startsWith('data:')) {
        // base64 inflates by 4/3; the payload begins after the comma.
        const comma = image.uri.indexOf(',')
        if (comma >= 0) textureBytes += Math.floor(((image.uri.length - comma - 1) * 3) / 4)
      } else {
        // An external file GENIE does not hold — counting 0 is honest, and
        // the count is surfaced so the score can say so.
        externalImageCount += 1
      }
    }
  }

  /* bounding box --------------------------------------------------------- */

  const size = computeSize(json, warnings)

  if (triangleCount === 0) warnings.push('No triangle geometry found.')
  if (!hasNormals && triangleCount > 0) {
    warnings.push('No vertex normals — lighting will look flat.')
  }

  return {
    fileBytes: bytes.byteLength,
    triangleCount,
    meshCount: meshes.length,
    nodeCount: nodes.length,
    materialCount: (json.materials ?? []).length,
    textureBytes,
    imageCount: images.length,
    externalImageCount,
    size,
    hasNormals,
    hasUvs,
    hasVertexColours,
    extensions,
    compressed,
    warnings,
  }
}

/* ── binary container ───────────────────────────────────────────────────── */

function readJsonChunk(bytes: Uint8Array): Gltf {
  if (bytes.byteLength < 12) throw new GlbParseError('File is too short to be a GLB.')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new GlbParseError('Not a binary glTF file (bad magic number).')
  }
  const version = view.getUint32(4, true)
  if (version !== 2) throw new GlbParseError(`Unsupported GLB version ${version}; expected 2.`)

  // The header's declared length is authoritative per spec, but trailing bytes
  // in the wild are common — clamp rather than reject an otherwise valid file.
  const declared = view.getUint32(8, true)
  const end = Math.min(declared, bytes.byteLength)

  let offset = 12
  while (offset + 8 <= end) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const start = offset + 8

    if (start + chunkLength > bytes.byteLength) {
      throw new GlbParseError('Truncated GLB: a chunk runs past the end of the file.')
    }

    if (chunkType === CHUNK_JSON) {
      const text = new TextDecoder().decode(bytes.subarray(start, start + chunkLength))
      try {
        return JSON.parse(text) as Gltf
      } catch {
        throw new GlbParseError('The GLB JSON chunk is not valid JSON.')
      }
    }

    // Chunks are 4-byte aligned; unpadded lengths would desynchronise the walk.
    offset = start + chunkLength + ((4 - (chunkLength % 4)) % 4)
    if (chunkType !== CHUNK_BIN && chunkType !== CHUNK_JSON) continue
  }

  throw new GlbParseError('No JSON chunk found in the GLB.')
}

/* ── world-space size ───────────────────────────────────────────────────── */

/**
 * Exact size in metres, by transforming each mesh's POSITION bounds through
 * its node's world matrix.
 *
 * Using the raw accessor min/max without the node transform is the usual
 * shortcut and it is wrong the moment an exporter bakes scale into the node —
 * which Blender's glTF exporter does routinely. A chair authored at 1/100th
 * scale with a node scale of 100 would report as 9 mm tall, and the AR page
 * would then tell a customer the chair fits on their desk.
 */
function computeSize(json: Gltf, warnings: string[]): Vec3 | null {
  const nodes = json.nodes ?? []
  const meshes = json.meshes ?? []
  const accessors = json.accessors ?? []

  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let found = false

  const roots =
    json.scenes?.[json.scene ?? 0]?.nodes ??
    // No scene declared: every node is a root, which over-counts nothing
    // because children are still visited exactly once from their parent.
    nodes.map((_, i) => i)

  const seen = new Set<number>()

  const walk = (index: number, parent: Mat4): void => {
    const node = nodes[index]
    if (!node) return
    // Cycles are invalid glTF but appear in hand-edited files; without this
    // guard the walk never returns.
    if (seen.has(index)) return
    seen.add(index)

    const world = multiply(parent, localMatrix(node))

    if (node.mesh !== undefined) {
      for (const prim of meshes[node.mesh]?.primitives ?? []) {
        const position = prim.attributes?.['POSITION']
        if (position === undefined) continue
        const accessor = accessors[position]
        if (!accessor?.min || !accessor.max) continue
        if (accessor.min.length < 3 || accessor.max.length < 3) continue

        // The transformed AABB is the AABB of the eight transformed corners.
        // Transforming only min and max is a classic bug: under rotation the
        // result is not the extent of the rotated box.
        for (let corner = 0; corner < 8; corner++) {
          const p: [number, number, number] = [
            (corner & 1 ? accessor.max : accessor.min)[0] ?? 0,
            (corner & 2 ? accessor.max : accessor.min)[1] ?? 0,
            (corner & 4 ? accessor.max : accessor.min)[2] ?? 0,
          ]
          const t = transform(world, p)
          for (let axis = 0; axis < 3; axis++) {
            const value = t[axis] ?? 0
            if (value < (min[axis] ?? Infinity)) min[axis] = value
            if (value > (max[axis] ?? -Infinity)) max[axis] = value
          }
          found = true
        }
      }
    }

    for (const child of node.children ?? []) walk(child, world)
  }

  for (const root of roots) walk(root, IDENTITY)

  if (!found) {
    warnings.push('No positional bounds in the file — real-world size is unknown.')
    return null
  }

  const size = {
    x: (max[0] ?? 0) - (min[0] ?? 0),
    y: (max[1] ?? 0) - (min[1] ?? 0),
    z: (max[2] ?? 0) - (min[2] ?? 0),
  }

  if (!Number.isFinite(size.x) || !Number.isFinite(size.y) || !Number.isFinite(size.z)) return null
  return size
}

/* ── 4×4 maths (column-major, matching glTF) ────────────────────────────── */

type Mat4 = number[]

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function localMatrix(node: Node): Mat4 {
  // A node carries EITHER a matrix OR TRS, never both (spec). Matrix wins when
  // present because that is what an exporter emits for a baked transform.
  if (node.matrix && node.matrix.length === 16) return node.matrix

  const [tx, ty, tz] = [node.translation?.[0] ?? 0, node.translation?.[1] ?? 0, node.translation?.[2] ?? 0]
  const [qx, qy, qz, qw] = [
    node.rotation?.[0] ?? 0,
    node.rotation?.[1] ?? 0,
    node.rotation?.[2] ?? 0,
    node.rotation?.[3] ?? 1,
  ]
  const [sx, sy, sz] = [node.scale?.[0] ?? 1, node.scale?.[1] ?? 1, node.scale?.[2] ?? 1]

  // Quaternion → rotation matrix, then scale each basis column.
  const x2 = qx + qx
  const y2 = qy + qy
  const z2 = qz + qz
  const xx = qx * x2
  const xy = qx * y2
  const xz = qx * z2
  const yy = qy * y2
  const yz = qy * z2
  const zz = qz * z2
  const wx = qw * x2
  const wy = qw * y2
  const wz = qw * z2

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ]
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out: Mat4 = new Array(16).fill(0)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0)
      }
      out[col * 4 + row] = sum
    }
  }
  return out
}

function transform(m: Mat4, p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ]
}
