/**
 * Generates the demo GLB assets.
 *
 *   node scripts/generate-demo-models.mjs
 *
 * Everything is built from Three.js primitives and exported with GLTFExporter,
 * so the repo carries no binary assets and needs no downloads — `npm install`
 * then this script is enough to have a working AR demo.
 *
 * SCALE IS THE POINT: glTF units are metres by specification, and the public
 * viewer runs with ar-scale="fixed". So every model here is authored at its
 * true physical size — a burger really is 12 cm across — and lands on the
 * customer's table correctly without any runtime fudging.
 *
 * REALISM: three things do the work, in this order of impact.
 *   1. Base-colour textures. A real surface is never one flat colour, and a
 *      flat colour is what makes an object read as a shape rather than as
 *      food.
 *   2. Normal maps. Crumb, weave, pores and grain are far too fine to model as
 *      geometry, but they are what catch the light.
 *   3. Displaced vertices. No texture fixes a silhouette — a perfect cylinder
 *      still outlines as a cylinder, so the actual mesh is pushed around.
 * Materials also carry honest roughness values: sauce is glossy, bun is matte,
 * and the difference between them is most of what sells a render.
 */

import * as THREE from 'three'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { installCanvasShim, encodePng } from './lib/canvas-shim.mjs'
import { render, downsample } from './lib/raster.mjs'
import {
  around,
  buildColorTexture,
  buildNormalTexture,
  cellular,
  displace,
  fbm,
  hexToRgb,
  mix,
  tileUvs,
  clamp01,
} from './lib/texture.mjs'

// Must run before GLTFExporter is imported: the exporter resolves
// `OffscreenCanvas` off globalThis when it rasterises a texture.
installCanvasShim()

const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')

const OUT_DIR = path.join(process.cwd(), 'public', 'models')
mkdirSync(OUT_DIR, { recursive: true })

const POSTER_DIR = path.join(process.cwd(), 'public', 'posters')
mkdirSync(POSTER_DIR, { recursive: true })

/**
 * Posters are rendered at 2x and downsampled.
 *
 * A poster is what model-viewer shows while a multi-megabyte GLB streams in,
 * what fills the catalogue grid, and what a shared link previews as. Rendering
 * one costs a few seconds here and saves every customer several seconds of
 * blank box on mobile data.
 */
const POSTER_SIZE = 640
const SUPERSAMPLE = 2

/** Deterministic RNG so regenerating produces byte-identical models. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Texture resolution.
 *
 * 256² is deliberate. These ship over mobile data to a phone at a restaurant
 * table, and a 1024² map is 16× the pixels for detail nobody sees on a 12 cm
 * object held at arm's length — the download cost would show up directly in
 * the scan-to-view drop-off.
 */
const TEX = 256

/**
 * Normal maps run at half the colour resolution.
 *
 * A normal map is a slowly-varying vector field sampled from a height
 * function; halving it costs almost nothing visually and removes three
 * quarters of its pixels. On the burger that is the difference between a
 * 1.5 MB and a 0.9 MB download, which is real seconds on a restaurant's wifi.
 */
const NORMAL_TEX = 128

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0, ...opts })

/** Standard material with a colour map and a matching normal map. */
function textured(shade, height, opts = {}) {
  const { normalStrength = 2, ...material } = opts
  return new THREE.MeshStandardMaterial({
    map: buildColorTexture(TEX, shade),
    normalMap: height ? buildNormalTexture(NORMAL_TEX, height, normalStrength) : null,
    roughness: 0.7,
    metalness: 0,
    ...material,
  })
}

/* ── materials ──────────────────────────────────────────────────────────── */

/** Baked bread: pale crumb, browner where it domed, flecked with bran. */
function bunMaterial(base, seed) {
  const pale = mix(hexToRgb(base), [255, 240, 205], 0.45)
  const dark = mix(hexToRgb(base), [92, 48, 16], 0.4)

  return textured(
    (u, v) => {
      const bake = fbm(u, v, { octaves: 4, frequency: 5, seed })
      const pores = cellular(u, v, 26, seed + 3)
      let colour = mix(pale, dark, clamp01(bake * 1.25 - 0.12))
      // Pore centres sit in shadow, which is what separates bread from plastic.
      colour = mix(colour, dark, (1 - pores) * 0.35)
      const fleck = fbm(u, v, { octaves: 2, frequency: 40, seed: seed + 11 })
      colour = mix(colour, [120, 78, 40], fleck > 0.78 ? 0.5 : 0)
      return colour
    },
    (u, v) => cellular(u, v, 26, seed + 3) * 0.6 + fbm(u, v, { octaves: 3, frequency: 12, seed }) * 0.4,
    { roughness: 0.92, normalStrength: 3 },
  )
}

/** Grilled beef: dark crust, char striping, glistening render. */
function pattyMaterial(seed) {
  const meat = [74, 43, 26]
  const char = [28, 18, 13]
  const sear = [126, 74, 40]

  return textured(
    (u, v) => {
      const grain = fbm(u, v, { octaves: 4, frequency: 9, seed })
      let colour = mix(meat, sear, grain * 0.8)
      // Grill bars: a hard band function, not noise — they are man-made.
      const bar = Math.abs(Math.sin(v * Math.PI * 7 + 0.4))
      if (bar > 0.93) colour = mix(colour, char, (bar - 0.93) / 0.07)
      colour = mix(colour, char, clamp01(fbm(u, v, { octaves: 2, frequency: 22, seed: seed + 5 }) - 0.55) * 1.6)
      return colour
    },
    (u, v) =>
      fbm(u, v, { octaves: 4, frequency: 16, seed }) * 0.7 +
      Math.abs(Math.sin(v * Math.PI * 7)) * 0.3,
    { roughness: 0.55, normalStrength: 2.6 },
  )
}

/** Melted cheese: warm, uneven, slightly translucent at the edges. */
function cheeseMaterial(seed) {
  const body = [240, 176, 46]
  const pale = [252, 219, 140]

  return textured(
    (u, v) => mix(body, pale, fbm(u, v, { octaves: 3, frequency: 6, seed }) * 0.75),
    (u, v) => fbm(u, v, { octaves: 3, frequency: 7, seed }),
    { roughness: 0.42, normalStrength: 1.4 },
  )
}

/** Leaf: veined, waxy on top. */
function leafMaterial(base, seed) {
  const light = mix(hexToRgb(base), [190, 230, 150], 0.5)
  const dark = mix(hexToRgb(base), [18, 52, 14], 0.45)

  return textured(
    (u, v) => {
      // Veins radiate from a central rib, so the pattern is a function of
      // distance from v = 0.5 rather than of noise.
      const rib = Math.exp(-Math.abs(v - 0.5) * 40)
      const veins = Math.abs(Math.sin(u * Math.PI * 9 + (v - 0.5) * 6))
      const body = fbm(u, v, { octaves: 3, frequency: 7, seed })
      let colour = mix(dark, light, body * 0.7 + 0.15)
      colour = mix(colour, light, rib * 0.6 + (veins > 0.94 ? 0.35 : 0))
      return colour
    },
    (u, v) => Math.exp(-Math.abs(v - 0.5) * 40) * 0.5 + fbm(u, v, { octaves: 3, frequency: 10, seed }) * 0.5,
    { roughness: 0.48, normalStrength: 2.2 },
  )
}

/** Woven fabric: a visible warp/weft at grazing angles. */
function fabricMaterial(base, seed) {
  const rgb = hexToRgb(base)
  const light = mix(rgb, [255, 255, 255], 0.16)
  const dark = mix(rgb, [0, 0, 0], 0.2)

  const weave = (u, v) => {
    const threads = 130
    const warp = Math.abs(Math.sin(u * Math.PI * threads))
    const weft = Math.abs(Math.sin(v * Math.PI * threads))
    // Over-under alternation, which is what makes it read as cloth rather
    // than as a grid.
    const over = (Math.floor(u * threads) + Math.floor(v * threads)) % 2 === 0
    return over ? warp : weft
  }

  return textured(
    (u, v) => {
      const w = weave(u, v)
      const slub = fbm(u, v, { octaves: 3, frequency: 14, seed })
      return mix(mix(dark, light, w), rgb, slub * 0.5)
    },
    (u, v) => weave(u, v) * 0.75 + fbm(u, v, { octaves: 2, frequency: 30, seed }) * 0.25,
    { roughness: 0.95, normalStrength: 1.8 },
  )
}

/** Timber: directional grain with occasional darker rays. */
function woodMaterial(base, seed) {
  const light = mix(hexToRgb(base), [222, 178, 128], 0.4)
  const dark = mix(hexToRgb(base), [58, 32, 14], 0.5)

  const grain = (u, v) => {
    // Rings are a function of one axis, warped slightly by noise — straight
    // stripes look printed, warped ones look sawn.
    const warp = fbm(u, v, { octaves: 3, frequency: 4, seed }) * 0.35
    return Math.abs(Math.sin((v + warp) * Math.PI * 26))
  }

  return textured(
    (u, v) => {
      const g = grain(u, v)
      let colour = mix(light, dark, Math.pow(g, 2.2) * 0.85)
      const ray = fbm(u, v, { octaves: 2, frequency: 60, seed: seed + 9 })
      if (ray > 0.8) colour = mix(colour, dark, 0.3)
      return colour
    },
    grain,
    { roughness: 0.62, normalStrength: 1.5 },
  )
}

/** Rubber outsole: matte, finely pitted. */
function rubberMaterial(base, seed) {
  const rgb = hexToRgb(base)
  return textured(
    (u, v) => mix(rgb, mix(rgb, [0, 0, 0], 0.35), 1 - cellular(u, v, 40, seed)),
    (u, v) => cellular(u, v, 40, seed),
    { roughness: 0.88, normalStrength: 1.6 },
  )
}

/** Knit mesh upper: a directional stitch, not a weave. */
function knitMaterial(base, seed) {
  const rgb = hexToRgb(base)
  const light = mix(rgb, [255, 255, 255], 0.22)
  const dark = mix(rgb, [0, 0, 0], 0.28)

  const stitch = (u, v) => {
    const rows = 70
    const offset = Math.floor(v * rows) % 2 === 0 ? 0 : 0.5
    return Math.abs(Math.sin((u * rows + offset) * Math.PI)) * Math.abs(Math.sin(v * Math.PI * rows))
  }

  return textured(
    (u, v) => mix(dark, light, stitch(u, v) * 0.8 + fbm(u, v, { octaves: 2, frequency: 20, seed }) * 0.2),
    stitch,
    { roughness: 0.82, normalStrength: 2.2 },
  )
}

/* ── Signature Burger — 12 cm bun, 10 cm tall ───────────────────────────────
   The exported bounding box reads 14.6 cm because the cheese slice is square
   and set at an angle, so its corners sit proud of the bun. That is what a
   cheeseburger looks like, and the AR scale badge reports the box, so the
   number is right even though it is wider than the bun.
   ────────────────────────────────────────────────────────────────────────── */

function buildBurger() {
  const g = new THREE.Group()
  const R = 0.06 // 12 cm diameter

  // Higher segment counts than a plain primitive needs, because the vertices
  // are about to be displaced and displacement can only move what exists.
  const topGeo = new THREE.SphereGeometry(R, 96, 56, 0, Math.PI * 2, 0, Math.PI / 2)
  displace(topGeo, 0.0016, 22, 5)
  // A hemisphere's u wraps the full circumference while v covers a quarter of
  // it, so without this the crumb is stretched 4:1 and reads as wood grain.
  tileUvs(topGeo, around(R), around(R) / 4, 0.03)
  const bunTop = new THREE.Mesh(topGeo, bunMaterial(0xc98b3f, 5))
  bunTop.scale.set(1, 0.62, 1)
  bunTop.position.y = 0.062
  g.add(bunTop)

  const seedMat = mat(0xf3e2bd, { roughness: 0.55 })
  const rand = rng(7)
  for (let i = 0; i < 34; i++) {
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.0024, 10, 8), seedMat)
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * R * 0.82
    const y = 0.062 + Math.sqrt(Math.max(0, 1 - (r / R) ** 2)) * R * 0.6
    seed.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
    seed.scale.set(1.6, 0.55, 1)
    seed.rotation.y = rand() * Math.PI
    g.add(seed)
  }

  // Lettuce as a ruffled ring: a torus with its vertices pushed around reads
  // as a leaf edge, where a clean torus reads as a rubber gasket.
  // Pulled in from the bun's radius so the ruffle displacement below stays
  // inside the burger's real 12–13 cm footprint rather than growing it.
  const lettuceGeo = new THREE.TorusGeometry(R * 0.88, 0.008, 16, 96)
  displace(lettuceGeo, 0.0022, 30, 11)
  tileUvs(lettuceGeo, around(R * 0.88), around(0.008), 0.05)
  const lettuce = new THREE.Mesh(lettuceGeo, leafMaterial(0x5c9e3a, 11))
  lettuce.rotation.x = Math.PI / 2
  lettuce.position.y = 0.052
  lettuce.scale.set(1, 1, 0.62)
  g.add(lettuce)

  const cheeseGeo = new THREE.BoxGeometry(R * 1.85, 0.0045, R * 1.85, 24, 2, 24)
  displace(cheeseGeo, 0.0011, 14, 13)
  tileUvs(cheeseGeo, R * 1.85, R * 1.85, 0.06)
  const cheese = new THREE.Mesh(cheeseGeo, cheeseMaterial(13))
  cheese.position.y = 0.045
  cheese.rotation.y = Math.PI / 8
  g.add(cheese)

  const pattyGeo = new THREE.CylinderGeometry(R * 0.95, R * 0.93, 0.017, 72, 6)
  displace(pattyGeo, 0.0018, 16, 17)
  tileUvs(pattyGeo, around(R * 0.95), 0.017, 0.04)
  const patty = new THREE.Mesh(pattyGeo, pattyMaterial(17))
  patty.position.y = 0.034
  g.add(patty)

  const tomato = new THREE.Mesh(
    tileUvs(new THREE.CylinderGeometry(R * 0.82, R * 0.82, 0.0065, 48, 1), 1, 1, 1),
    textured(
      (u, v) => {
        // Radial pulp: the pattern is a function of angle around the slice,
        // which is what a cylinder's u coordinate already is.
        const segments = Math.abs(Math.sin(u * Math.PI * 6))
        const flesh = mix([198, 46, 34], [232, 96, 74], segments * 0.6)
        return mix(flesh, [244, 186, 150], clamp01(fbm(u, v, { octaves: 2, frequency: 12, seed: 23 }) - 0.55) * 2)
      },
      (u, v) => Math.abs(Math.sin(u * Math.PI * 6)) * 0.6 + fbm(u, v, { octaves: 2, frequency: 14, seed: 23 }) * 0.4,
      { roughness: 0.34, normalStrength: 1.8 },
    ),
  )
  tomato.position.y = 0.023
  g.add(tomato)

  const bottomGeo = new THREE.CylinderGeometry(R, R * 0.9, 0.019, 72, 6)
  displace(bottomGeo, 0.0012, 20, 29)
  // 37 cm around by 1.9 cm tall: the worst aspect on the model, and the reason
  // the untiled version looked like plywood.
  tileUvs(bottomGeo, around(R), 0.019, 0.03)
  const bunBottom = new THREE.Mesh(bottomGeo, bunMaterial(0xba7c36, 29))
  bunBottom.position.y = 0.009
  g.add(bunBottom)

  return g
}

/* ── Cold Coffee — 8 cm across, 15 cm tall ──────────────────────────────── */

function buildColdCoffee() {
  const g = new THREE.Group()

  // Glass is transmissive in reality. glTF's KHR_materials_transmission is not
  // something GLTFExporter writes from MeshStandardMaterial, so this uses a
  // low-roughness translucent standard material — closer to acrylic than to
  // glass, but it reads correctly and loads everywhere.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xdfeaf2,
    roughness: 0.06,
    metalness: 0.02,
    transparent: true,
    opacity: 0.28,
  })

  const profile = [
    new THREE.Vector2(0.03, 0.0),
    new THREE.Vector2(0.034, 0.012),
    new THREE.Vector2(0.038, 0.06),
    new THREE.Vector2(0.041, 0.125),
    new THREE.Vector2(0.0415, 0.14),
  ]
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), glassMat)
  g.add(glass)

  const coffee = new THREE.Mesh(
    tileUvs(new THREE.CylinderGeometry(0.0385, 0.032, 0.1, 64), around(0.0385), 0.1, 0.05),
    textured(
      (u, v) => mix([74, 44, 26], [122, 78, 44], fbm(u, v, { octaves: 3, frequency: 5, seed: 31 }) * 0.6),
      (u, v) => fbm(u, v, { octaves: 3, frequency: 8, seed: 31 }),
      { roughness: 0.24, normalStrength: 0.8 },
    ),
  )
  coffee.position.y = 0.055
  g.add(coffee)

  const foamGeo = new THREE.CylinderGeometry(0.0392, 0.0388, 0.015, 64, 3)
  displace(foamGeo, 0.0009, 40, 37)
  tileUvs(foamGeo, around(0.0392), 0.015, 0.03)
  const foam = new THREE.Mesh(
    foamGeo,
    textured(
      (u, v) => mix([246, 235, 214], [214, 190, 158], 1 - cellular(u, v, 34, 37)),
      (u, v) => cellular(u, v, 34, 37),
      { roughness: 0.9, normalStrength: 2.4 },
    ),
  )
  foam.position.y = 0.111
  g.add(foam)

  const straw = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0035, 0.0035, 0.13, 20),
    textured(
      (u) => (Math.floor(u * 10) % 2 === 0 ? [212, 68, 58] : [248, 244, 240]),
      null,
      { roughness: 0.32 },
    ),
  )
  straw.position.set(0.014, 0.135, 0.006)
  straw.rotation.z = -0.22
  g.add(straw)

  return g
}

/* ── Margherita Pizza — 30 cm across ────────────────────────────────────── */

function buildPizza() {
  const g = new THREE.Group()
  const R = 0.15

  const baseGeo = new THREE.CylinderGeometry(R, R * 0.97, 0.013, 128, 4)
  displace(baseGeo, 0.0016, 12, 41)
  tileUvs(baseGeo, around(R), 0.013, 0.04)
  const base = new THREE.Mesh(baseGeo, bunMaterial(0xd8a860, 41))
  base.position.y = 0.006
  g.add(base)

  // The cornicione is where a pizza is most obviously baked — blistered,
  // unevenly browned, and never a smooth torus.
  const crustGeo = new THREE.TorusGeometry(R * 0.94, 0.012, 20, 128)
  displace(crustGeo, 0.0026, 26, 43)
  tileUvs(crustGeo, around(R * 0.94), around(0.012), 0.05)
  const crust = new THREE.Mesh(
    crustGeo,
    textured(
      (u, v) => {
        const bake = fbm(u, v, { octaves: 4, frequency: 8, seed: 43 })
        const blister = cellular(u, v, 22, 47)
        let colour = mix([228, 186, 128], [146, 82, 34], clamp01(bake * 1.3 - 0.1))
        // Leopard spotting: the char points a wood oven leaves.
        if (blister < 0.16) colour = mix(colour, [58, 34, 18], (0.16 - blister) / 0.16)
        return colour
      },
      (u, v) => cellular(u, v, 22, 47) * 0.55 + fbm(u, v, { octaves: 3, frequency: 14, seed: 43 }) * 0.45,
      { roughness: 0.9, normalStrength: 3.2 },
    ),
  )
  crust.rotation.x = Math.PI / 2
  crust.position.y = 0.013
  g.add(crust)

  const sauce = new THREE.Mesh(
    tileUvs(new THREE.CylinderGeometry(R * 0.88, R * 0.88, 0.0032, 96), 1, 1, 1),
    textured(
      (u, v) => mix([154, 40, 26], [196, 74, 44], fbm(u, v, { octaves: 4, frequency: 10, seed: 53 })),
      (u, v) => fbm(u, v, { octaves: 4, frequency: 16, seed: 53 }),
      { roughness: 0.3, normalStrength: 1.4 },
    ),
  )
  sauce.position.y = 0.0135
  g.add(sauce)

  const mozMat = textured(
    (u, v) => mix([248, 244, 230], [226, 210, 176], fbm(u, v, { octaves: 3, frequency: 9, seed: 59 }) * 0.8),
    (u, v) => fbm(u, v, { octaves: 3, frequency: 11, seed: 59 }),
    { roughness: 0.36, normalStrength: 1.6 },
  )
  const basilMat = leafMaterial(0x2f6b1e, 61)

  const rand = rng(21)
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.3
    const r = (0.28 + rand() * 0.5) * R

    // Mozzarella pools rather than sitting as a disc, so each blob is a
    // squashed sphere with its own displacement.
    const mozGeo = new THREE.SphereGeometry(0.016, 20, 14)
    displace(mozGeo, 0.0018, 24, 59 + i)
    const moz = new THREE.Mesh(mozGeo, mozMat)
    moz.scale.set(1, 0.26, 1)
    moz.position.set(Math.cos(a) * r, 0.017, Math.sin(a) * r)
    g.add(moz)

    const basilGeo = new THREE.SphereGeometry(0.009, 14, 10)
    displace(basilGeo, 0.0009, 30, 61 + i)
    const basil = new THREE.Mesh(basilGeo, basilMat)
    basil.scale.set(1.35, 0.22, 0.92)
    basil.position.set(Math.cos(a + 0.4) * r * 0.8, 0.0198, Math.sin(a + 0.4) * r * 0.8)
    basil.rotation.y = rand() * Math.PI
    g.add(basil)
  }

  return g
}

/* ── Classic Sneaker — 28 cm long ───────────────────────────────────────── */

function buildSneaker() {
  const g = new THREE.Group()

  const outsole = new THREE.Mesh(
    tileUvs(new THREE.BoxGeometry(0.28, 0.022, 0.1, 40, 4, 16), 0.28, 0.1, 0.05),
    rubberMaterial(0xe9e9e6, 67),
  )
  outsole.position.y = 0.011
  g.add(outsole)

  const midGeo = new THREE.BoxGeometry(0.276, 0.015, 0.098, 40, 4, 16)
  displace(midGeo, 0.0008, 18, 71)
  tileUvs(midGeo, 0.276, 0.098, 0.05)
  const midsole = new THREE.Mesh(
    midGeo,
    textured(
      (u, v) => mix([228, 228, 224], [198, 198, 192], fbm(u, v, { octaves: 3, frequency: 12, seed: 71 })),
      (u, v) => fbm(u, v, { octaves: 3, frequency: 18, seed: 71 }),
      { roughness: 0.78, normalStrength: 1.4 },
    ),
  )
  midsole.position.y = 0.029
  g.add(midsole)

  const knit = knitMaterial(0x2b3a55, 73)

  const upper = new THREE.Mesh(
    tileUvs(new THREE.BoxGeometry(0.2, 0.055, 0.092, 30, 12, 16), 0.2, 0.092, 0.05),
    knit,
  )
  upper.position.set(-0.032, 0.062, 0)
  g.add(upper)

  const toe = new THREE.Mesh(
    tileUvs(new THREE.SphereGeometry(0.05, 40, 26), around(0.05), around(0.05) / 2, 0.05),
    knit,
  )
  toe.scale.set(1.05, 0.62, 0.92)
  toe.position.set(0.089, 0.05, 0)
  g.add(toe)

  const heel = new THREE.Mesh(
    tileUvs(new THREE.BoxGeometry(0.036, 0.075, 0.09, 10, 16, 16), 0.09, 0.075, 0.05),
    knit,
  )
  heel.position.set(-0.122, 0.07, 0)
  g.add(heel)

  const swoosh = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.016, 0.004),
    mat(0xe8453c, { roughness: 0.35 }),
  )
  swoosh.position.set(-0.01, 0.055, 0.047)
  swoosh.rotation.z = 0.08
  g.add(swoosh)

  const laceMat = textured(
    (u, v) => mix([246, 246, 240], [206, 206, 198], Math.abs(Math.sin(v * Math.PI * 44)) * 0.8),
    (u, v) => Math.abs(Math.sin(v * Math.PI * 44)),
    { roughness: 0.86, normalStrength: 2 },
  )
  for (let i = 0; i < 4; i++) {
    const lace = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.07, 12), laceMat)
    lace.rotation.x = Math.PI / 2
    lace.position.set(-0.02 + i * 0.028, 0.09, 0)
    g.add(lace)
  }

  return g
}

/* ── Lounge Chair — 70 cm wide, 80 cm tall ──────────────────────────────── */

function buildChair() {
  const g = new THREE.Group()
  const wood = woodMaterial(0x8a5a33, 79)
  const fabric = fabricMaterial(0x5f6f5a, 83)

  // Upholstery is soft, so the cushions get real displacement — a hard-edged
  // box reads as a crate no matter how good the fabric texture is.
  const seatGeo = new THREE.BoxGeometry(0.62, 0.1, 0.58, 30, 8, 28)
  displace(seatGeo, 0.006, 5, 83)
  tileUvs(seatGeo, 0.62, 0.58, 0.18)
  const seat = new THREE.Mesh(seatGeo, fabric)
  seat.position.y = 0.42
  g.add(seat)

  const backGeo = new THREE.BoxGeometry(0.62, 0.5, 0.1, 30, 24, 8)
  displace(backGeo, 0.005, 5, 89)
  tileUvs(backGeo, 0.62, 0.5, 0.18)
  const back = new THREE.Mesh(backGeo, fabric)
  back.position.set(0, 0.68, -0.24)
  back.rotation.x = -0.14
  g.add(back)

  for (const [x, z] of [
    [-0.26, -0.24],
    [0.26, -0.24],
    [-0.26, 0.24],
    [0.26, 0.24],
  ]) {
    const leg = new THREE.Mesh(
      tileUvs(new THREE.CylinderGeometry(0.022, 0.017, 0.38, 24), around(0.022), 0.38, 0.12),
      wood,
    )
    leg.position.set(x, 0.19, z)
    g.add(leg)
  }

  for (const x of [-0.32, 0.32]) {
    const arm = new THREE.Mesh(
      tileUvs(new THREE.BoxGeometry(0.05, 0.05, 0.5, 8, 8, 30), 0.5, 0.05, 0.12),
      wood,
    )
    arm.position.set(x, 0.6, 0)
    g.add(arm)
    const post = new THREE.Mesh(
      tileUvs(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 18), around(0.018), 0.16, 0.12),
      wood,
    )
    post.position.set(x, 0.52, 0.2)
    g.add(post)
  }

  return g
}

/* ── export ─────────────────────────────────────────────────────────────── */

const MODELS = [
  { file: 'signature-burger.glb', build: buildBurger },
  { file: 'cold-coffee.glb', build: buildColdCoffee },
  { file: 'margherita-pizza.glb', build: buildPizza },
  { file: 'classic-sneaker.glb', build: buildSneaker },
  { file: 'lounge-chair.glb', build: buildChair },
]

const exporter = new GLTFExporter()

for (const { file, build } of MODELS) {
  const scene = new THREE.Scene()
  const model = build()
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  scene.add(model)

  const buffer = await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(result),
      (err) => reject(err),
      { binary: true },
    )
  })

  const out = path.join(OUT_DIR, file)
  writeFileSync(out, Buffer.from(buffer))

  const big = render(model, {
    width: POSTER_SIZE * SUPERSAMPLE,
    height: POSTER_SIZE * SUPERSAMPLE,
    // Matches the --card token the public page paints behind the viewer, so
    // the poster and the live model sit on the same ground with no flash of a
    // different colour at the handover.
    background: [250, 250, 251],
  })
  const small = downsample(big.pixels, big.width, big.height, SUPERSAMPLE)
  const posterName = file.replace(/\.glb$/, '.png')
  writeFileSync(path.join(POSTER_DIR, posterName), encodePng(small.pixels, small.width, small.height))

  // Report the authored bounding box so scale mistakes are visible immediately.
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  let triangles = 0
  model.traverse((o) => {
    if (o.isMesh) {
      const index = o.geometry.getIndex()
      triangles += (index ? index.count : o.geometry.attributes.position.count) / 3
    }
  })

  console.log(
    `${file.padEnd(24)} ${(Buffer.from(buffer).length / 1024).toFixed(1).padStart(7)} KB   ` +
      `${(size.x * 100).toFixed(1)} × ${(size.y * 100).toFixed(1)} × ${(size.z * 100).toFixed(1)} cm   ` +
      `${Math.round(triangles).toLocaleString().padStart(8)} tris`,
  )
}

console.log(`\nWrote ${MODELS.length} models to public/models/`)
