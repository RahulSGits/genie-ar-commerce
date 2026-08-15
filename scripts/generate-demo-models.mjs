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
 */

import * as THREE from 'three'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * GLTFExporter is written for the browser and reaches for FileReader when
 * packing the binary chunk. Node has Blob but not FileReader, so a minimal
 * shim covering the one method the exporter calls is installed before the
 * exporter module is loaded.
 */
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null
      this.onloadend = null
      this.onerror = null
    }
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf
          this.onloadend?.()
        })
        .catch((err) => this.onerror?.(err))
    }
    readAsDataURL(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`
          this.onloadend?.()
        })
        .catch((err) => this.onerror?.(err))
    }
  }
}

const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')

const OUT_DIR = path.join(process.cwd(), 'public', 'models')
mkdirSync(OUT_DIR, { recursive: true })

/* Deterministic RNG so regenerating produces byte-identical models. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0, ...opts })

/* ── Signature Burger — 12 cm wide, 9 cm tall ───────────────────────────── */

function buildBurger() {
  const g = new THREE.Group()
  const R = 0.06 // 12 cm diameter

  const bunTop = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xc98b3f, { roughness: 0.8 }))
  bunTop.scale.set(1, 0.62, 1)
  bunTop.position.y = 0.062
  g.add(bunTop)

  // Sesame seeds
  const rand = rng(7)
  for (let i = 0; i < 22; i++) {
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 6, 5), mat(0xf5e3bb))
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * R * 0.8
    const y = 0.062 + Math.sqrt(Math.max(0, 1 - (r / R) ** 2)) * R * 0.6
    seed.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
    seed.scale.set(1.5, 0.7, 1)
    g.add(seed)
  }

  const lettuce = new THREE.Mesh(new THREE.TorusGeometry(R * 0.92, 0.008, 8, 40), mat(0x5c9e3a, { roughness: 0.75 }))
  lettuce.rotation.x = Math.PI / 2
  lettuce.position.y = 0.052
  lettuce.scale.set(1, 1, 0.6)
  g.add(lettuce)

  const cheese = new THREE.Mesh(new THREE.BoxGeometry(R * 1.85, 0.004, R * 1.85), mat(0xf0a91e, { roughness: 0.5 }))
  cheese.position.y = 0.045
  cheese.rotation.y = Math.PI / 8
  g.add(cheese)

  const patty = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.95, R * 0.95, 0.016, 32), mat(0x4a2b18, { roughness: 0.9 }))
  patty.position.y = 0.034
  g.add(patty)

  const tomato = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.82, R * 0.82, 0.006, 24), mat(0xc32b22))
  tomato.position.y = 0.023
  g.add(tomato)

  const bunBottom = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.9, 0.018, 32), mat(0xba7c36, { roughness: 0.85 }))
  bunBottom.position.y = 0.009
  g.add(bunBottom)

  return g
}

/* ── Cold Coffee — 8 cm across, 15 cm tall ──────────────────────────────── */

function buildColdCoffee() {
  const g = new THREE.Group()

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xdfeaf2, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.34,
  })

  const profile = []
  profile.push(new THREE.Vector2(0.030, 0.0))
  profile.push(new THREE.Vector2(0.034, 0.012))
  profile.push(new THREE.Vector2(0.038, 0.06))
  profile.push(new THREE.Vector2(0.041, 0.125))
  profile.push(new THREE.Vector2(0.0415, 0.14))
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), glassMat)
  g.add(glass)

  const coffee = new THREE.Mesh(new THREE.CylinderGeometry(0.0385, 0.032, 0.1, 40), mat(0x5b3a22, { roughness: 0.35 }))
  coffee.position.y = 0.055
  g.add(coffee)

  const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.0392, 0.0388, 0.014, 40), mat(0xf2e6d2, { roughness: 0.85 }))
  foam.position.y = 0.111
  g.add(foam)

  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.13, 12), mat(0xd4443a, { roughness: 0.4 }))
  straw.position.set(0.014, 0.135, 0.006)
  straw.rotation.z = -0.22
  g.add(straw)

  return g
}

/* ── Margherita Pizza — 30 cm across ────────────────────────────────────── */

function buildPizza() {
  const g = new THREE.Group()
  const R = 0.15

  const base = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.97, 0.012, 64), mat(0xd8a860, { roughness: 0.9 }))
  base.position.y = 0.006
  g.add(base)

  const crust = new THREE.Mesh(new THREE.TorusGeometry(R * 0.94, 0.011, 12, 64), mat(0xc98f45, { roughness: 0.9 }))
  crust.rotation.x = Math.PI / 2
  crust.position.y = 0.013
  g.add(crust)

  const sauce = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.88, R * 0.88, 0.003, 56), mat(0xb3321f, { roughness: 0.55 }))
  sauce.position.y = 0.0135
  g.add(sauce)

  const rand = rng(21)
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.3
    const r = (0.28 + rand() * 0.5) * R
    const moz = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.004, 18), mat(0xf7f2e2, { roughness: 0.6 }))
    moz.position.set(Math.cos(a) * r, 0.017, Math.sin(a) * r)
    g.add(moz)

    const basil = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), mat(0x2f6b1e, { roughness: 0.7 }))
    basil.scale.set(1.3, 0.28, 0.9)
    basil.position.set(Math.cos(a + 0.4) * r * 0.8, 0.0195, Math.sin(a + 0.4) * r * 0.8)
    basil.rotation.y = rand() * Math.PI
    g.add(basil)
  }

  return g
}

/* ── Classic Sneaker — 28 cm long ───────────────────────────────────────── */

function buildSneaker() {
  const g = new THREE.Group()

  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.022, 0.1), mat(0xf2f2f0, { roughness: 0.7 }))
  sole.position.y = 0.011
  g.add(sole)

  const midsole = new THREE.Mesh(new THREE.BoxGeometry(0.276, 0.014, 0.098), mat(0xdcdcd8, { roughness: 0.8 }))
  midsole.position.y = 0.029
  g.add(midsole)

  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.092), mat(0x2b3a55, { roughness: 0.75 }))
  upper.position.set(-0.032, 0.062, 0)
  g.add(upper)

  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), mat(0x2b3a55, { roughness: 0.75 }))
  toe.scale.set(1.05, 0.62, 0.92)
  toe.position.set(0.089, 0.05, 0)
  g.add(toe)

  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.075, 0.09), mat(0x222e44, { roughness: 0.75 }))
  heel.position.set(-0.122, 0.07, 0)
  g.add(heel)

  const swoosh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.016, 0.004), mat(0xe8453c, { roughness: 0.5 }))
  swoosh.position.set(-0.01, 0.055, 0.047)
  swoosh.rotation.z = 0.08
  g.add(swoosh)

  for (let i = 0; i < 4; i++) {
    const lace = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.07, 8), mat(0xf5f5f0))
    lace.rotation.x = Math.PI / 2
    lace.position.set(-0.02 + i * 0.028, 0.09, 0)
    g.add(lace)
  }

  return g
}

/* ── Lounge Chair — 70 cm wide, 80 cm tall ──────────────────────────────── */

function buildChair() {
  const g = new THREE.Group()
  const wood = mat(0x8a5a33, { roughness: 0.8 })
  const fabric = mat(0x5f6f5a, { roughness: 0.95 })

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.09, 0.58), fabric)
  seat.position.y = 0.42
  g.add(seat)

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.1), fabric)
  back.position.set(0, 0.68, -0.24)
  back.rotation.x = -0.14
  g.add(back)

  for (const [x, z] of [[-0.26, -0.24], [0.26, -0.24], [-0.26, 0.24], [0.26, 0.24]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.017, 0.38, 12), wood)
    leg.position.set(x, 0.19, z)
    g.add(leg)
  }

  for (const x of [-0.32, 0.32]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), wood)
    arm.position.set(x, 0.6, 0)
    g.add(arm)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 10), wood)
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

  // Report the authored bounding box so scale mistakes are visible immediately.
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  console.log(
    `${file.padEnd(24)} ${(Buffer.from(buffer).length / 1024).toFixed(1).padStart(7)} KB   ` +
      `${(size.x * 100).toFixed(1)} × ${(size.y * 100).toFixed(1)} × ${(size.z * 100).toFixed(1)} cm`,
  )
}

console.log(`\nWrote ${MODELS.length} models to public/models/`)
