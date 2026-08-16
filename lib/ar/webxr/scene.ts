import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * The rendered half of the WebXR session: camera passthrough compositing, the
 * placement reticle, the model, and the gestures that move it.
 *
 * Three.js rather than model-viewer, because model-viewer deliberately owns its
 * own session and will not let a page draw into it or read its hit tests —
 * which is exactly what a custom AR UI needs. model-viewer remains the right
 * tool for the 3D viewer and for the iOS Quick Look handoff; this is the one
 * place the lower-level API is required.
 */

export type PlacementMode = 'floor' | 'tabletop' | 'wall'

export type SceneOptions = {
  glbUrl: string
  /** Real-world size in metres, used to sanity-check the authored scale. */
  realSizeM?: { width: number; height: number; depth: number } | null
  placement: PlacementMode
  minScale: number
  maxScale: number
  defaultScale: number
  defaultRotationY: number
}

export type SceneEvents = {
  onSurfaceFound?: () => void
  onSurfaceLost?: () => void
  onPlaced?: () => void
  onInteraction?: () => void
  onModelLoaded?: (dimensions: { x: number; y: number; z: number }) => void
  onError?: (message: string) => void
}

export class ArScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera()
  private reticle: THREE.Mesh
  private model: THREE.Group | null = null
  private modelHolder = new THREE.Group()

  private hitTestSource: XRHitTestSource | null = null
  private refSpace: XRReferenceSpace | null = null
  private viewerSpace: XRReferenceSpace | null = null
  private anchor: XRAnchor | null = null

  private lightProbe: XRLightProbe | null = null
  private envLight = new THREE.HemisphereLight(0xffffff, 0xbbbbbb, 1)
  private keyLight = new THREE.DirectionalLight(0xffffff, 1.4)

  private lastFrame: XRFrame | null = null
  private surfaceVisible = false
  private isPlaced = false
  private baseScale = 1
  private userScale = 1
  private userRotation = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: SceneOptions,
    private readonly events: SceneEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      // Required: without this the renderer cannot be handed to the XR session
      // and every frame composites against a black background instead of the
      // camera feed.
      preserveDrawingBuffer: false,
    })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.xr.enabled = true
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene.add(this.envLight)
    this.keyLight.position.set(0.5, 3, 1)
    this.keyLight.castShadow = true
    this.scene.add(this.keyLight)

    // A shadow-catcher: invisible to the camera but darkened where the model
    // occludes light. This is what stops a placed object looking like a sticker
    // floating above the table.
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    )
    shadowPlane.rotation.x = -Math.PI / 2
    shadowPlane.receiveShadow = true
    this.modelHolder.add(shadowPlane)

    this.reticle = new THREE.Mesh(
      // A flat ring lying on the detected plane reads as "here", where a 3D
      // marker reads as an object and gets mistaken for the product.
      new THREE.RingGeometry(0.055, 0.07, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.9 }),
    )
    this.reticle.matrixAutoUpdate = false
    this.reticle.visible = false
    this.scene.add(this.reticle)

    this.modelHolder.visible = false
    this.scene.add(this.modelHolder)
  }

  get placed(): boolean {
    return this.isPlaced
  }

  get surfaceReady(): boolean {
    return this.surfaceVisible
  }

  /**
   * Loads the model before the session starts.
   *
   * Deliberately separate from `attach`: `requestSession` must be called inside
   * the user's tap, and awaiting a multi-megabyte download first would consume
   * the gesture and fail the session.
   */
  async loadModel(): Promise<void> {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(this.options.glbUrl)

    const model = gltf.scene
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = false
      }
    })

    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())

    // glTF units are metres by specification, so a correctly authored model is
    // already real-world sized. The declared dimensions are used only to
    // CORRECT a model that is not — an AI-generated asset routinely comes back
    // normalised to a unit cube, and placing a 1-metre burger on someone's
    // table is the single most obvious way to break the illusion.
    const declared = this.options.realSizeM
    if (declared && size.x > 0 && size.z > 0) {
      const declaredLargest = Math.max(declared.width, declared.height, declared.depth)
      const actualLargest = Math.max(size.x, size.y, size.z)
      const ratio = declaredLargest / actualLargest
      // Only correct when the mismatch is large. Nudging every model to the
      // declared size would fight correctly-authored assets over rounding.
      if (ratio > 1.5 || ratio < 0.66) this.baseScale = ratio
    }

    // Centre horizontally and sit the model on its own base, so the pivot is
    // the point that touches the surface rather than the mesh origin.
    const centre = box.getCenter(new THREE.Vector3())
    model.position.x -= centre.x
    model.position.z -= centre.z
    model.position.y -= box.min.y

    if (this.options.placement === 'wall') {
      // Wall-mounted items hang rather than stand: the depth axis becomes the
      // one facing the viewer.
      model.rotation.x = -Math.PI / 2
    }

    model.rotation.y = (this.options.defaultRotationY * Math.PI) / 180

    this.model = model
    this.modelHolder.add(model)
    this.userScale = this.options.defaultScale
    this.applyTransform()

    this.events.onModelLoaded?.({ x: size.x, y: size.y, z: size.z })
  }

  /** Binds the loaded scene to a live XR session and starts the frame loop. */
  async attach(session: XRSession, granted: { anchors: boolean; lightEstimation: boolean }) {
    await this.renderer.xr.setSession(session)

    this.refSpace =
      (await session.requestReferenceSpace('local-floor').catch(() => null)) ??
      (await session.requestReferenceSpace('local'))
    this.viewerSpace = await session.requestReferenceSpace('viewer')

    if (session.requestHitTestSource && this.viewerSpace) {
      // The hit test ray originates from the viewer, straight ahead — the
      // centre of the screen is where the user is pointing, and it is what the
      // reticle tracks.
      this.hitTestSource =
        (await session.requestHitTestSource({ space: this.viewerSpace })) ?? null
    }

    if (granted.lightEstimation && session.requestLightProbe) {
      try {
        this.lightProbe = await session.requestLightProbe()
      } catch {
        // Not fatal — the scene keeps its default studio lighting.
      }
    }

    this.renderer.setAnimationLoop((_, frame) => this.onFrame(frame))
  }

  private onFrame(frame: XRFrame | undefined): void {
    if (!frame || !this.refSpace) return
    // Held so `place()` can create an anchor from the tap: the XR 'select'
    // event carries no frame of its own, and an anchor needs one.
    this.lastFrame = frame

    if (this.lightProbe) this.applyRealWorldLight(frame)

    if (!this.isPlaced && this.hitTestSource) {
      const hits = frame.getHitTestResults(this.hitTestSource)
      const hit = hits[0]

      if (hit) {
        const pose = hit.getPose(this.refSpace)
        if (pose) {
          this.reticle.visible = true
          this.reticle.matrix.fromArray(pose.transform.matrix)
          if (!this.surfaceVisible) {
            this.surfaceVisible = true
            this.events.onSurfaceFound?.()
          }
        }
      } else if (this.surfaceVisible) {
        this.reticle.visible = false
        this.surfaceVisible = false
        this.events.onSurfaceLost?.()
      }
    }

    // An anchor lets the runtime keep correcting the object's pose as its
    // understanding of the room improves. Without one the model drifts as the
    // user walks around it, which is exactly the moment the illusion has to
    // hold.
    if (this.anchor && this.anchor.anchorSpace) {
      const pose = frame.getPose(this.anchor.anchorSpace, this.refSpace)
      if (pose) {
        this.modelHolder.matrix.fromArray(pose.transform.matrix)
        this.modelHolder.matrix.decompose(
          this.modelHolder.position,
          this.modelHolder.quaternion,
          new THREE.Vector3(),
        )
        this.applyTransform()
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  /**
   * Applies the room's real lighting to the model.
   *
   * The spherical harmonics the runtime provides describe ambient colour and
   * intensity; the primary light direction is where the strongest light comes
   * from. Matching both is what makes a virtual object look like it is sitting
   * under the same lamps as the table it is on.
   */
  private applyRealWorldLight(frame: XRFrame): void {
    if (!this.lightProbe) return
    const estimate = frame.getLightEstimate?.(this.lightProbe)
    if (!estimate) return

    const primary = estimate.primaryLightIntensity
    if (primary) {
      const intensity = Math.max(primary.x, primary.y, primary.z)
      this.keyLight.intensity = Math.min(3, Math.max(0.3, intensity))
      this.keyLight.color.setRGB(
        primary.x / (intensity || 1),
        primary.y / (intensity || 1),
        primary.z / (intensity || 1),
      )
    }

    const direction = estimate.primaryLightDirection
    if (direction) this.keyLight.position.set(direction.x, direction.y, direction.z).multiplyScalar(3)

    const sh = estimate.sphericalHarmonicsCoefficients
    // The first SH band is the average ambient colour of the room.
    if (sh && sh.length >= 3) {
      this.envLight.intensity = Math.min(2, Math.max(0.2, (sh[0]! + sh[1]! + sh[2]!) / 3 + 0.5))
    }
  }

  /** Places the model at the reticle. Returns false when no surface is found. */
  async place(): Promise<boolean> {
    if (this.isPlaced || !this.reticle.visible || !this.model) return false

    this.modelHolder.matrix.copy(this.reticle.matrix)
    this.modelHolder.matrix.decompose(
      this.modelHolder.position,
      this.modelHolder.quaternion,
      new THREE.Vector3(),
    )
    this.applyTransform()
    this.modelHolder.visible = true
    this.reticle.visible = false
    this.isPlaced = true

    // Anchor if the runtime offers it. Failure is non-fatal: the object stays
    // where it was put, it just will not be re-corrected as tracking improves.
    if (this.lastFrame && this.hitTestSource) {
      const hit = this.lastFrame.getHitTestResults(this.hitTestSource)[0]
      if (hit?.createAnchor) {
        try {
          this.anchor = (await hit.createAnchor()) ?? null
        } catch {
          this.anchor = null
        }
      }
    }

    this.events.onPlaced?.()
    return true
  }

  rotateBy(radians: number): void {
    this.userRotation += radians
    this.applyTransform()
    this.events.onInteraction?.()
  }

  scaleBy(factor: number): void {
    const next = this.userScale * factor
    // Clamped to the business's configured bounds: an unclamped pinch lets a
    // customer shrink a sofa to a matchbox and conclude it will fit.
    this.userScale = Math.min(this.options.maxScale, Math.max(this.options.minScale, next))
    this.applyTransform()
    this.events.onInteraction?.()
  }

  /** Lifts placement so the next tap re-places the model. */
  reposition(): void {
    this.isPlaced = false
    this.anchor = null
    this.modelHolder.visible = false
    this.events.onInteraction?.()
  }

  reset(): void {
    this.userScale = this.options.defaultScale
    this.userRotation = 0
    this.applyTransform()
    this.events.onInteraction?.()
  }

  get scaleFactor(): number {
    return this.userScale
  }

  private applyTransform(): void {
    const scale = this.baseScale * this.userScale
    this.modelHolder.scale.setScalar(scale)
    if (this.model) {
      this.model.rotation.y =
        (this.options.defaultRotationY * Math.PI) / 180 + this.userRotation
    }
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.hitTestSource?.cancel?.()
    this.hitTestSource = null
    this.model?.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const material = mesh.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose()
      }
    })
    this.renderer.dispose()
  }
}
