import { describe, expect, it } from 'vitest'
import {
  safeStorageName,
  validateImageUpload,
  validateModelUpload,
  MAX_MODEL_BYTES,
} from '@/lib/storage/modelValidation'

/** Builds a buffer with the given leading bytes, padded to `size`. */
function bytes(header: number[], size = 64): Uint8Array {
  const out = new Uint8Array(size)
  out.set(header, 0)
  return out
}

const GLB = bytes([0x67, 0x6c, 0x54, 0x46, 0x02, 0, 0, 0, 0, 0, 0, 0])
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04])
const PNG = bytes([0x89, 0x50, 0x4e, 0x47])
const JPEG = bytes([0xff, 0xd8, 0xff])

describe('model upload validation', () => {
  it('accepts a real GLB by its magic bytes', () => {
    const result = validateModelUpload(GLB, 'burger.glb')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.format).toBe('glb')
  })

  it('trusts the bytes over the extension', () => {
    // Renaming a GLB to .usdz must not change how it is treated.
    const result = validateModelUpload(GLB, 'burger.usdz')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.format).toBe('glb')
      expect(result.warnings.join(' ')).toMatch(/extension/i)
    }
  })

  it('rejects an arbitrary ZIP that only claims to be a model', () => {
    const result = validateModelUpload(ZIP, 'payload.zip')
    expect(result.ok).toBe(false)
  })

  it('accepts a ZIP only when the extension independently says usdz', () => {
    const result = validateModelUpload(ZIP, 'chair.usdz')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.format).toBe('usdz')
  })

  it('rejects an executable renamed to .glb', () => {
    const elf = bytes([0x7f, 0x45, 0x4c, 0x46])
    expect(validateModelUpload(elf, 'model.glb').ok).toBe(false)
  })

  it('rejects an empty file', () => {
    expect(validateModelUpload(new Uint8Array(0), 'empty.glb', 0).ok).toBe(false)
  })

  it('rejects a file over the size ceiling', () => {
    const result = validateModelUpload(GLB, 'huge.glb', MAX_MODEL_BYTES + 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/limit/i)
  })

  it('warns but accepts a large-but-legal file', () => {
    const result = validateModelUpload(GLB, 'big.glb', 9 * 1024 * 1024)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings.join(' ')).toMatch(/mobile data/i)
  })

  it('warns that .gltf references external files', () => {
    const gltf = new TextEncoder().encode('{"asset":{"version":"2.0"},"scenes":[]}')
    const result = validateModelUpload(gltf, 'scene.gltf')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings.join(' ')).toMatch(/external/i)
  })
})

describe('image upload validation', () => {
  it('accepts PNG and JPEG', () => {
    expect(validateImageUpload(PNG).ok).toBe(true)
    expect(validateImageUpload(JPEG).ok).toBe(true)
  })

  it('rejects SVG — it is executable markup and a stored-XSS vector', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(validateImageUpload(svg).ok).toBe(false)
  })
})

describe('safeStorageName', () => {
  const id = 'abc123'

  it('keeps a normal name readable', () => {
    expect(safeStorageName('Signature Burger.glb', id)).toBe('abc123-signature-burger.glb')
  })

  it('defuses path traversal', () => {
    const name = safeStorageName('../../../etc/passwd.glb', id)
    expect(name).not.toContain('..')
    expect(name).not.toContain('/')
    expect(name.startsWith(id)).toBe(true)
  })

  it('always prefixes with the id so concurrent uploads cannot collide', () => {
    expect(safeStorageName('model.glb', 'one').startsWith('one')).toBe(true)
    expect(safeStorageName('model.glb', 'two').startsWith('two')).toBe(true)
  })
})
