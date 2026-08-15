import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { PLACEMENT_DEFAULT_SIZE_M } from '@/config/terminology'
import { horizontalRadiusM, type PublicArProduct } from '@/types/ar'

export type LoadedModel = {
  /** Wrapper group, normalised so its horizontal radius is exactly 1 unit. */
  object: THREE.Group
  /**
   * Metres per normalised unit. Multiply the wrapper's scale by this and the
   * model stands at its true real-world size.
   */
  realWorldRadiusM: number
  /** How the size was determined — surfaced in the dashboard, not to customers. */
  scaleSource: 'dimensions' | 'placement-default'
  triangleCount: number
  /** Authored bounding box in the GLB's own units, before normalisation. */
  sourceSize: THREE.Vector3
}

export type LoadProgress = {
  loaded: number
  total: number
  /** -1 when the server sent no Content-Length, meaning show an indeterminate bar. */
  percent: number
}

export class ModelLoadError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ModelLoadError'
  }
}

let cachedLoader: GLTFLoader | null = null

function getLoader(): GLTFLoader {
  if (cachedLoader) return cachedLoader

  const loader = new GLTFLoader()

  // Draco and Meshopt are the two compressions food/product scans actually ship
  // with. Decoders are served from our own /public — never a CDN, so the AR page
  // has no third-party dependency and works behind a strict CSP.
  const draco = new DRACOLoader()
  draco.setDecoderPath('/draco/')
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)

  cachedLoader = loader
  return loader
}

/**
 * Normalises an arbitrary model into a predictable frame:
 *   · centred on the origin in X/Z
 *   · lowest point resting on y = 0, so it sits ON a detected plane
 *   · horizontal radius scaled to exactly 1 unit
 *
 * This is what makes real-world scaling possible at all. A GLB may be authored
 * in metres, centimetres, inches or something arbitrary, and nothing in the
 * file reliably says which. Rather than trusting the file, we discard its scale
 * entirely and rebuild it from the product's declared physical dimensions.
 */
function normalise(object: THREE.Object3D): { radius: number; size: THREE.Vector3 } {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())

  const radius = Math.max(size.x, size.z) / 2 || 1
  const k = 1 / radius

  object.scale.setScalar(k)
  object.position.set(-centre.x * k, -box.min.y * k, -centre.z * k)

  return { radius, size }
}

function countTriangles(root: THREE.Object3D): number {
  let tris = 0
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const geom = mesh.geometry
    if (geom.index) tris += geom.index.count / 3
    else if (geom.attributes.position) tris += geom.attributes.position.count / 3
  })
  return Math.round(tris)
}

/**
 * Loads a product's GLB and prepares it for AR.
 *
 * Throws `ModelLoadError` on failure — the caller is responsible for showing
 * the "Unable to load the 3D model" state with Try Again / Back, rather than
 * silently substituting something else.
 */
export async function loadProductModel(
  product: PublicArProduct,
  opts: { onProgress?: (p: LoadProgress) => void; signal?: AbortSignal } = {},
): Promise<LoadedModel> {
  const url = product.model?.glbUrl
  if (!url) {
    throw new ModelLoadError(`No 3D model is attached to “${product.name}”.`)
  }
  if (product.model?.status !== 'ready') {
    throw new ModelLoadError(
      `The 3D model for “${product.name}” is still being processed. Try again shortly.`,
    )
  }

  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new ModelLoadError('aborted'))

    const onAbort = () => reject(new ModelLoadError('aborted'))
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    getLoader().load(
      url,
      (result) => {
        opts.signal?.removeEventListener('abort', onAbort)
        resolve(result as unknown as { scene: THREE.Group })
      },
      (ev) => {
        if (!opts.onProgress) return
        const total = ev.total || 0
        opts.onProgress({
          loaded: ev.loaded || 0,
          total,
          percent: total > 0 ? Math.min(100, (ev.loaded / total) * 100) : -1,
        })
      },
      (err) => {
        opts.signal?.removeEventListener('abort', onAbort)
        reject(new ModelLoadError(`Could not load the 3D model for “${product.name}”.`, err))
      },
    )
  })

  const root = gltf.scene
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })

  const { radius, size } = normalise(root)

  const wrapper = new THREE.Group()
  wrapper.add(root)

  // Real-world size: the business's declared dimensions win. Falling back to a
  // per-placement default keeps an un-measured product plausible rather than
  // landing it 40× too large.
  const declared = horizontalRadiusM(product.dimensions)
  const fallback = (PLACEMENT_DEFAULT_SIZE_M[product.placement] ?? 0.3) / 2
  const realWorldRadiusM = (declared ?? fallback) * (product.scaleMultiplier || 1)

  return {
    object: wrapper,
    realWorldRadiusM,
    scaleSource: declared !== null ? 'dimensions' : 'placement-default',
    triangleCount: countTriangles(root),
    sourceSize: size.clone().multiplyScalar(radius === 0 ? 1 : 1),
  }
}

/** Frees GPU memory for a model that is no longer on screen. */
export function disposeModel(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach(disposeMaterial)
    else if (material) disposeMaterial(material)
  })
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value && typeof value === 'object' && 'isTexture' in value) {
      ;(value as THREE.Texture).dispose()
    }
  }
  material.dispose()
}
