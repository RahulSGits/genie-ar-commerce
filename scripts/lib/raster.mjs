/**
 * A small software rasteriser, so the demo models can have real poster images.
 *
 * WHY THIS EXISTS: a poster is the frame model-viewer shows while the GLB
 * downloads, the thumbnail in the catalogue grid, and the Open Graph image when
 * a customer shares a product. Without one, a scan over mobile data is several
 * seconds of blank box, and a shared link is a grey rectangle.
 *
 * WHY NOT JUST RENDER WITH THREE.JS: WebGLRenderer needs a GL context, and Node
 * has none. The usual answer is `headless-gl`, a native module that needs a
 * compiler and system GL headers — a build dependency for what amounts to five
 * PNGs generated once. Rasterising in software is a few hundred lines, has no
 * dependencies at all, and runs anywhere `node` does.
 *
 * This is NOT a general-purpose renderer. It handles what the demo models
 * actually use: opaque triangles, base-colour textures, a directional light and
 * an ambient term. No transparency sorting, no PBR, no shadows.
 */

import * as THREE from 'three'

/**
 * Renders `object` to an RGBA buffer.
 *
 * The camera frames the object automatically from its bounding sphere, so a
 * 12 cm burger and a 93 cm chair both fill the frame without per-model tuning.
 */
export function render(object, { width = 600, height = 600, background = null } = {}) {
  const triangles = collect(object)
  if (triangles.length === 0) throw new Error('Nothing to render.')

  const box = new THREE.Box3().setFromObject(object)
  const sphere = box.getBoundingSphere(new THREE.Sphere())

  // A three-quarter view from slightly above: the angle a product is
  // photographed from, and the one that reads as depth rather than silhouette.
  const direction = new THREE.Vector3(0.55, 0.42, 1).normalize()
  const fov = 32
  // Pull back far enough that the bounding sphere fits the vertical FOV, with
  // a little margin so nothing kisses the frame edge.
  const distance = (sphere.radius / Math.sin((fov * Math.PI) / 360)) * 1.08

  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.001, distance * 4)
  camera.position.copy(sphere.center).addScaledVector(direction, distance)
  camera.lookAt(sphere.center)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()

  const viewProjection = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  )

  const pixels = new Uint8ClampedArray(width * height * 4)
  if (background) {
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = background[0]
      pixels[i + 1] = background[1]
      pixels[i + 2] = background[2]
      pixels[i + 3] = 255
    }
  }

  // Depth buffer in NDC z. Initialised to +Infinity: nearer fragments win.
  const depth = new Float32Array(width * height).fill(Infinity)

  const light = new THREE.Vector3(0.4, 0.9, 0.55).normalize()
  const eye = camera.position.clone()

  for (const tri of triangles) {
    drawTriangle(tri, { viewProjection, width, height, pixels, depth, light, eye })
  }

  return { pixels, width, height }
}

/* ── scene traversal ────────────────────────────────────────────────────── */

/**
 * Flattens the scene into world-space triangles.
 *
 * Non-indexed and indexed geometry both appear in the demo models (the exporter
 * normalises some), so both are handled rather than assuming one.
 */
function collect(root) {
  const triangles = []
  root.updateMatrixWorld(true)

  root.traverse((node) => {
    if (!node.isMesh || !node.visible) return

    const geometry = node.geometry
    const position = geometry.attributes.position
    if (!position) return

    const normalAttr = geometry.attributes.normal
    const uvAttr = geometry.attributes.uv
    const index = geometry.getIndex()

    const material = Array.isArray(node.material) ? node.material[0] : node.material
    if (!material) return

    // A fully transparent mesh is a shadow catcher, not something to draw.
    if (material.transparent && material.opacity !== undefined && material.opacity < 0.15) return

    const world = node.matrixWorld
    // Normals transform by the inverse-transpose, not the world matrix — using
    // the world matrix on a non-uniformly scaled node tilts every normal and
    // the shading goes subtly wrong in a way that reads as "plastic".
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(world)

    const texture = material.map ?? null
    const image = texture?.image ?? null
    const colour = material.color
      ? [material.color.r * 255, material.color.g * 255, material.color.b * 255]
      : [200, 200, 200]

    const count = index ? index.count : position.count
    const at = (i) => (index ? index.getX(i) : i)

    for (let i = 0; i < count; i += 3) {
      const [a, b, c] = [at(i), at(i + 1), at(i + 2)]
      const vertices = []

      for (const vi of [a, b, c]) {
        const p = new THREE.Vector3().fromBufferAttribute(position, vi).applyMatrix4(world)
        const n = normalAttr
          ? new THREE.Vector3().fromBufferAttribute(normalAttr, vi).applyMatrix3(normalMatrix).normalize()
          : new THREE.Vector3(0, 1, 0)
        const uv = uvAttr ? [uvAttr.getX(vi), uvAttr.getY(vi)] : [0, 0]
        vertices.push({ p, n, uv })
      }

      triangles.push({
        vertices,
        colour,
        image,
        roughness: material.roughness ?? 0.7,
        metalness: material.metalness ?? 0,
        opacity: material.transparent ? (material.opacity ?? 1) : 1,
      })
    }
  })

  return triangles
}

/* ── rasterisation ──────────────────────────────────────────────────────── */

function drawTriangle(tri, ctx) {
  const { viewProjection, width, height, pixels, depth, light, eye } = ctx

  // Project to clip space, then to screen.
  const clip = tri.vertices.map((v) => {
    const q = new THREE.Vector4(v.p.x, v.p.y, v.p.z, 1).applyMatrix4(viewProjection)
    return q
  })

  // Anything behind the camera would project to a mirrored, wildly wrong
  // triangle. Clipping properly needs polygon splitting; for these models
  // dropping the triangle is correct and invisible.
  if (clip.some((q) => q.w <= 0)) return

  const screen = clip.map((q) => ({
    x: ((q.x / q.w) * 0.5 + 0.5) * width,
    y: (1 - ((q.y / q.w) * 0.5 + 0.5)) * height,
    z: q.z / q.w,
    // 1/w, for perspective-correct interpolation of UVs across the triangle.
    invW: 1 / q.w,
  }))

  const [s0, s1, s2] = screen
  const area = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y)
  // Backface cull, keeping NEGATIVE area.
  //
  // glTF front faces are counter-clockwise in NDC, but the projection above
  // flips y to put the origin at the top-left for pixel addressing — and that
  // flip reverses the winding. Testing for positive area here keeps the BACK
  // faces, which renders every closed object inside-out: the bun showed its
  // own interior. Zero area is a degenerate triangle and would divide by zero.
  if (area >= 0) return

  const minX = Math.max(0, Math.floor(Math.min(s0.x, s1.x, s2.x)))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(s0.x, s1.x, s2.x)))
  const minY = Math.max(0, Math.floor(Math.min(s0.y, s1.y, s2.y)))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(s0.y, s1.y, s2.y)))
  if (minX > maxX || minY > maxY) return

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5
      const py = y + 0.5

      // Barycentric coordinates via edge functions.
      const w0 = ((s1.x - s0.x) * (py - s0.y) - (px - s0.x) * (s1.y - s0.y)) / area
      const w1 = ((px - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (py - s0.y)) / area
      const w2 = 1 - w0 - w1
      if (w0 < 0 || w1 < 0 || w2 < 0) continue

      // Weights map to vertices as (v0, v1, v2) = (w2, w1, w0) given how the
      // edge functions above are formed.
      const bary = [w2, w1, w0]
      const z = bary[0] * s0.z + bary[1] * s1.z + bary[2] * s2.z

      const offset = y * width + x
      if (z >= depth[offset]) continue

      // Perspective-correct UV: interpolating in screen space warps the texture
      // across large triangles, which on the pizza base is a visible smear.
      const invW = bary[0] * s0.invW + bary[1] * s1.invW + bary[2] * s2.invW
      const uv = [0, 0]
      const normal = new THREE.Vector3()
      const world = new THREE.Vector3()

      for (let k = 0; k < 3; k++) {
        const weight = (bary[k] * screen[k].invW) / invW
        uv[0] += tri.vertices[k].uv[0] * weight
        uv[1] += tri.vertices[k].uv[1] * weight
        normal.addScaledVector(tri.vertices[k].n, bary[k])
        world.addScaledVector(tri.vertices[k].p, bary[k])
      }
      normal.normalize()

      const texel = tri.image ? sample(tri.image, uv[0], uv[1]) : tri.colour

      // Lambert diffuse plus a fixed ambient floor, then a Blinn-Phong
      // highlight scaled by smoothness. Enough to read as a lit object without
      // pretending to be physically based.
      const lambert = Math.max(0, normal.dot(light))
      const ambient = 0.34
      const intensity = ambient + lambert * 0.95

      const view = eye.clone().sub(world).normalize()
      const half = view.add(light).normalize()
      const specular =
        Math.pow(Math.max(0, normal.dot(half)), 8 + (1 - tri.roughness) * 120) *
        (1 - tri.roughness) *
        0.5

      // Light in LINEAR space, not sRGB.
      //
      // Texture bytes and material colours are sRGB-encoded, and multiplying an
      // sRGB value by a light intensity is not the same operation as scaling
      // the light that reaches a surface. Doing it directly crushes mid-tones —
      // the first render of these posters came out muddy and brown for exactly
      // this reason. Decode, light, re-encode.
      const lit = texel.map((c) => toSrgb(toLinear(c / 255) * intensity + specular) * 255)
      const [r, g, b] = lit

      const alpha = tri.opacity
      const base = offset * 4
      if (alpha >= 1) {
        pixels[base] = r
        pixels[base + 1] = g
        pixels[base + 2] = b
        pixels[base + 3] = 255
      } else {
        // Single-layer blend. Correct transparency needs back-to-front sorting;
        // the only translucent thing here is the coffee glass, and one layer
        // reads fine.
        pixels[base] = pixels[base] * (1 - alpha) + r * alpha
        pixels[base + 1] = pixels[base + 1] * (1 - alpha) + g * alpha
        pixels[base + 2] = pixels[base + 2] * (1 - alpha) + b * alpha
        pixels[base + 3] = Math.max(pixels[base + 3], Math.round(alpha * 255))
      }
      depth[offset] = z
    }
  }
}

/* ── colour space ───────────────────────────────────────────────────────── */

/** sRGB 0–1 → linear 0–1. The IEC 61966-2-1 transfer function, not a 2.2 gamma. */
function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function toSrgb(c) {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/** Bilinear sample of a THREE.DataTexture's raw RGBA bytes. */
function sample(image, u, v) {
  const { data, width, height } = image
  if (!data || !width || !height) return [200, 200, 200]

  // Repeat wrapping, matching how the textures are authored.
  const fu = ((u % 1) + 1) % 1
  const fv = ((v % 1) + 1) % 1

  const x = fu * (width - 1)
  const y = fv * (height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0

  const at = (px, py) => {
    const i = (py * width + px) * 4
    return [data[i], data[i + 1], data[i + 2]]
  }

  const c00 = at(x0, y0)
  const c10 = at(x1, y0)
  const c01 = at(x0, y1)
  const c11 = at(x1, y1)

  const out = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    const top = c00[k] * (1 - tx) + c10[k] * tx
    const bottom = c01[k] * (1 - tx) + c11[k] * tx
    out[k] = top * (1 - ty) + bottom * ty
  }
  return out
}

/**
 * Downsamples a supersampled buffer.
 *
 * Rendering at 2× and averaging is the cheapest antialiasing there is, and
 * without it every silhouette on these models is a visible staircase.
 */
export function downsample(pixels, width, height, factor) {
  const outW = Math.floor(width / factor)
  const outH = Math.floor(height / factor)
  const out = new Uint8ClampedArray(outW * outH * 4)

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * width + (x * factor + dx)) * 4
          r += pixels[i]
          g += pixels[i + 1]
          b += pixels[i + 2]
          a += pixels[i + 3]
        }
      }
      const n = factor * factor
      const o = (y * outW + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return { pixels: out, width: outW, height: outH }
}
