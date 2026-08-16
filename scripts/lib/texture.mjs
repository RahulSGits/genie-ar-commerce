/**
 * Procedural PBR textures.
 *
 * The single biggest reason an untextured model reads as "a 3D shape" rather
 * than as food is that real surfaces are never one flat colour. A bun is
 * pale in the creases and dark on the ridges; a tomato slice has radial pulp;
 * mozzarella is mottled. All of that is colour variation at a scale far below
 * the geometry, which is what a texture is for.
 *
 * Everything here is generated from a seeded noise function, so the output is
 * byte-identical run to run and the repository still carries no binary assets.
 */

import * as THREE from 'three'

/* ── noise ──────────────────────────────────────────────────────────────── */

/** Deterministic hash → [0,1). Integer lattice input. */
function hash2(x, y, seed) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + seed * 1274126177
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smoothstep, so interpolated noise has no visible lattice creases. */
const fade = (t) => t * t * (3 - 2 * t)

/**
 * Value noise on a wrapping lattice.
 *
 * The wrap is what makes the texture tile: without it every map shows a seam
 * where u passes 1, and on a cylinder that seam lands as a visible stripe down
 * the side of the model.
 */
export function valueNoise(x, y, period, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = fade(x - x0)
  const fy = fade(y - y0)

  const wrap = (v) => ((v % period) + period) % period
  const [ax, ay] = [wrap(x0), wrap(y0)]
  const [bx, by] = [wrap(x0 + 1), wrap(y0 + 1)]

  const n00 = hash2(ax, ay, seed)
  const n10 = hash2(bx, ay, seed)
  const n01 = hash2(ax, by, seed)
  const n11 = hash2(bx, by, seed)

  return (
    n00 * (1 - fx) * (1 - fy) + n10 * fx * (1 - fy) + n01 * (1 - fx) * fy + n11 * fx * fy
  )
}

/** Fractional Brownian motion — several octaves of value noise. */
export function fbm(u, v, { octaves = 4, frequency = 8, gain = 0.5, seed = 1 } = {}) {
  let total = 0
  let amplitude = 1
  let normalisation = 0
  let freq = frequency

  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise(u * freq, v * freq, freq, seed + octave * 101) * amplitude
    normalisation += amplitude
    amplitude *= gain
    freq *= 2
  }
  return total / normalisation
}

/** Cellular (Worley) noise — the right shape for pores, seeds and mottling. */
export function cellular(u, v, cells, seed) {
  const cu = u * cells
  const cv = v * cells
  const ix = Math.floor(cu)
  const iy = Math.floor(cv)
  let nearest = Infinity

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = ((ix + dx) % cells + cells) % cells
      const gy = ((iy + dy) % cells + cells) % cells
      const px = ix + dx + hash2(gx, gy, seed)
      const py = iy + dy + hash2(gx, gy, seed + 977)
      const d = (px - cu) ** 2 + (py - cv) ** 2
      if (d < nearest) nearest = d
    }
  }
  return Math.min(1, Math.sqrt(nearest))
}

/* ── colour helpers ─────────────────────────────────────────────────────── */

export function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
}

export function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/* ── texture building ───────────────────────────────────────────────────── */

/**
 * Builds an RGBA DataTexture from a per-texel function.
 *
 * `shade(u, v)` returns [r, g, b] in 0–255 and an optional alpha. Colour maps
 * are tagged SRGBColorSpace because that is what a base-colour texture is;
 * leaving it linear washes every model out by roughly a gamma.
 */
export function buildColorTexture(size, shade, { seed = 1 } = {}) {
  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const [r, g, b, a = 255] = shade(u, v, seed)
      const i = (y * size + x) * 4
      data[i] = clamp255(r)
      data[i + 1] = clamp255(g)
      data[i + 2] = clamp255(b)
      data[i + 3] = clamp255(a)
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // DataTexture rows are already top-down, and the exporter would otherwise
  // add a flip that inverts every map relative to the UVs.
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/**
 * Derives a tangent-space normal map from a height function.
 *
 * Central differences rather than forward differences: a forward difference
 * biases every slope half a texel in one direction, which shows up as the
 * whole surface appearing lit from a slightly wrong angle.
 */
export function buildNormalTexture(size, height, strength = 2) {
  const data = new Uint8Array(size * size * 4)
  const step = 1 / size

  const sample = (u, v) => height(((u % 1) + 1) % 1, ((v % 1) + 1) % 1)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size

      const dx = (sample(u + step, v) - sample(u - step, v)) * strength
      const dy = (sample(u, v + step) - sample(u, v - step)) * strength

      // The surface normal of a heightfield is (-dh/du, -dh/dv, 1), normalised.
      let nx = -dx
      let ny = -dy
      let nz = 1
      const length = Math.hypot(nx, ny, nz)
      nx /= length
      ny /= length
      nz /= length

      const i = (y * size + x) * 4
      data[i] = clamp255((nx * 0.5 + 0.5) * 255)
      data[i + 1] = clamp255((ny * 0.5 + 0.5) * 255)
      data[i + 2] = clamp255((nz * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  // A normal map holds vectors, not colour — tagging it sRGB would apply a
  // gamma curve to geometry data and tilt every normal.
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

/* ── geometry detail ────────────────────────────────────────────────────── */

/**
 * Pushes vertices along their normals by a noise field.
 *
 * Textures alone cannot fix a silhouette: a perfect cylinder still reads as a
 * cylinder no matter what is painted on it. Displacing the actual vertices is
 * what makes the outline of a bun or a patty look baked rather than machined.
 */
export function displace(geometry, amount, frequency = 6, seed = 3) {
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)

    // Sampled in object space so the field is continuous across seams — a
    // UV-space sample would tear where the UVs do.
    const n =
      fbm((x + 0.5) * frequency, (z + 0.5) * frequency, { octaves: 3, frequency: 2, seed }) - 0.5
    const m = fbm((y + 0.5) * frequency, (x + 0.5) * frequency, { octaves: 2, frequency: 3, seed: seed + 7 }) - 0.5
    const offset = (n * 0.7 + m * 0.3) * amount * 2

    position.setXYZ(
      i,
      x + normal.getX(i) * offset,
      y + normal.getY(i) * offset,
      z + normal.getZ(i) * offset,
    )
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/* ── UV aspect correction ───────────────────────────────────────────────── */

/**
 * Rescales a geometry's UVs so one texture tile covers a fixed physical size.
 *
 * This is the difference between "textured" and "textured correctly". Every
 * primitive parameterises UV 0–1 across its whole surface regardless of shape,
 * so on the bottom bun — a cylinder 37 cm around and 1.9 cm tall — one texture
 * tile is stretched 20:1. Isotropic noise painted into that comes out as
 * horizontal bands, and a bun ends up looking like plywood.
 *
 * Passing the real world-space span of each UV axis restores the aspect, so
 * the crumb is the same size everywhere on the model and across models.
 * Requires RepeatWrapping, since the scaled coordinates run past 1.
 */
export function tileUvs(geometry, uSpanMetres, vSpanMetres, tileMetres = 0.05) {
  const uv = geometry.attributes.uv
  if (!uv) return geometry

  const su = uSpanMetres / tileMetres
  const sv = vSpanMetres / tileMetres

  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  }
  uv.needsUpdate = true
  return geometry
}

/** Circumference helper, so call sites read as the geometry they describe. */
export const around = (radius) => 2 * Math.PI * radius
