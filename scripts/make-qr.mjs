/**
 * Writes a printable QR PNG for a given URL.
 *   node scripts/make-qr.mjs [url] [outfile]
 * Defaults to the local dev origin so the table code can be produced without
 * deploying anything.
 */
import QRCode from 'qrcode'

const url = process.argv[2] ?? 'http://localhost:3000/'
const out = process.argv[3] ?? 'public/table-qr.png'

await QRCode.toFile(out, url, {
  width: 900,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#23211c', light: '#ffffff' },
})

console.log(`wrote ${out} → ${url}`)
