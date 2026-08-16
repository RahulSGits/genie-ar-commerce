/**
 * Just enough of the browser canvas API for GLTFExporter to write textures.
 *
 * GLTFExporter rasterises every texture through a canvas before packing it
 * into the GLB, and Node has no canvas. The usual answers are `node-canvas`
 * (a native build with a Cairo dependency) or `@napi-rs/canvas` (a 10 MB
 * prebuilt binary) — both of which would put a compiled dependency in the way
 * of `npm install`, for the sake of three method calls.
 *
 * The exporter's DataTexture path only ever calls putImageData and then asks
 * for a PNG blob, so that is exactly what this implements. Everything else
 * throws rather than silently returning blank pixels, so a future change to
 * the exporter surfaces as an error instead of as textureless models.
 */

import { deflateSync } from 'node:zlib'

/* ── PNG encoding ───────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** RGBA8 pixels → a PNG buffer. Filter type 0 on every scanline. */
export function encodePng(pixels, width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour with alpha
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Each scanline is prefixed with its filter byte. Filter 0 (None) keeps the
  // encoder trivial; deflate still compresses these textures to a few KB
  // because procedural noise over a flat base has a lot of redundancy.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    )
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ── canvas shims ───────────────────────────────────────────────────────── */

class ShimImageData {
  constructor(data, width, height) {
    this.data = data
    this.width = width
    this.height = height
  }
}

class ShimContext2D {
  constructor(canvas) {
    this.canvas = canvas
    this.flipY = false
  }

  /** The exporter calls translate+scale to express a vertical flip. */
  translate() {
    /* Recorded via scale(); the offset is always (0, height). */
  }

  scale(_x, y) {
    if (y === -1) this.flipY = !this.flipY
  }

  putImageData(imageData, dx, dy) {
    if (dx !== 0 || dy !== 0) {
      throw new Error('canvas-shim: putImageData only supports a (0,0) origin.')
    }

    const { width, height } = this.canvas
    const out = new Uint8ClampedArray(width * height * 4)
    const stride = width * 4

    for (let y = 0; y < height; y++) {
      const source = this.flipY ? height - 1 - y : y
      out.set(imageData.data.subarray(source * stride, source * stride + stride), y * stride)
    }
    this.canvas._pixels = out
  }

  getImageData(x, y, width, height) {
    if (x !== 0 || y !== 0) throw new Error('canvas-shim: getImageData needs a (0,0) origin.')
    const pixels = this.canvas._pixels ?? new Uint8ClampedArray(width * height * 4)
    return new ShimImageData(pixels, width, height)
  }

  drawImage() {
    // Only reached when a material sets metalnessMap or roughnessMap, which
    // would need real rasterisation of a second texture. The generator uses
    // scalar roughness/metalness instead, so reaching here is a mistake worth
    // failing loudly on.
    throw new Error(
      'canvas-shim: drawImage is not implemented. Use scalar roughness/metalness rather than maps.',
    )
  }

  fillRect() {
    /* No-op: only used to prime the metallic-roughness composite. */
  }

  set fillStyle(_value) {
    /* Ignored, as above. */
  }
}

class ShimOffscreenCanvas {
  constructor(width = 1, height = 1) {
    this.width = width
    this.height = height
    this._pixels = null
  }

  getContext(type) {
    if (type !== '2d') throw new Error(`canvas-shim: unsupported context "${type}".`)
    this._context ??= new ShimContext2D(this)
    return this._context
  }

  async convertToBlob({ type = 'image/png' } = {}) {
    if (type !== 'image/png') {
      throw new Error(`canvas-shim: only image/png is supported, asked for ${type}.`)
    }
    const pixels = this._pixels ?? new Uint8ClampedArray(this.width * this.height * 4)
    return new Blob([encodePng(pixels, this.width, this.height)], { type: 'image/png' })
  }
}

/**
 * Installs the shims. Must run BEFORE GLTFExporter is imported, because the
 * exporter captures `typeof OffscreenCanvas` at call time against globalThis.
 */
export function installCanvasShim() {
  if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = ShimImageData
  if (typeof globalThis.OffscreenCanvas === 'undefined') {
    globalThis.OffscreenCanvas = ShimOffscreenCanvas
  }

  // GLTFExporter reaches for FileReader when packing the binary chunk. Node
  // has Blob but not FileReader, so the one method it calls is shimmed too.
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
          .then((buffer) => {
            this.result = buffer
            this.onloadend?.()
          })
          .catch((err) => this.onerror?.(err))
      }
      readAsDataURL(blob) {
        blob
          .arrayBuffer()
          .then((buffer) => {
            this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`
            this.onloadend?.()
          })
          .catch((err) => this.onerror?.(err))
      }
    }
  }
}
