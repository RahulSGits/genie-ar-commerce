'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import {
  Box, Download, FileImage, ImageIcon, Printer, QrCode as QrCodeIcon, Smartphone,
} from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/components/ui'
import { formatBytes, slugify } from '@/lib/utils'
import PrintSheet from '@/components/dashboard/PrintSheet'
import type { CurrencyCode } from '@/utils/money'
import type { ModelStatus } from '@/types/domain'

export type DownloadProduct = {
  name: string
  slug: string
  priceMinor: number | null
  currency: CurrencyCode
  imageUrl: string | null
}

export type DownloadModel = {
  name: string
  status: ModelStatus
  glbUrl: string | null
  usdzUrl: string | null
  fileSizeBytes: number
}

/** One downloadable file, or the honest explanation of why it does not exist. */
type Asset = {
  key: string
  name: string
  format: string
  purpose: string
  icon: ReactNode
  bytes: number | null
  href: string | null
  filename: string
  /** Non-null means the row renders as unavailable with this reason. */
  missing: string | null
}

/** A data URL carries its payload as base64, so the byte count is arithmetic. */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

type GeneratedQr = {
  target: string
  pngUrl: string
  pngBytes: number
  svgUrl: string
  svgBytes: number
}

export default function DownloadCentre({
  product,
  model,
  qr,
  business,
}: {
  product: DownloadProduct
  model: DownloadModel | null
  /** Token only — the qr repository is server-only and must not be imported here. */
  qr: { token: string; label: string } | null
  business: { name: string; logoUrl: string | null }
}) {
  const [generated, setGenerated] = useState<GeneratedQr | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!qr) return

    // The origin is only knowable in the browser: an operator working on a LAN
    // dev host has to print a code their own phone can actually resolve.
    const target = `${window.location.origin}/r/${qr.token}`
    let cancelled = false
    let svgUrl: string | null = null

    async function build() {
      const pngUrl = await QRCode.toDataURL(target, { width: 1024, margin: 2 })
      const svg = await QRCode.toString(target, { type: 'svg' })
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      svgUrl = URL.createObjectURL(blob)
      if (cancelled) return
      setGenerated({
        target,
        pngUrl,
        pngBytes: dataUrlBytes(pngUrl),
        svgUrl,
        svgBytes: blob.size,
      })
    }

    void build().catch(() => {
      if (!cancelled) setGenerated(null)
    })

    return () => {
      cancelled = true
      if (svgUrl) URL.revokeObjectURL(svgUrl)
    }
  }, [qr])

  const base = slugify(product.slug || product.name) || 'product'

  const glbMissing = !model
    ? 'No 3D model attached — Android AR and the 3D viewer both need one'
    : model.status !== 'ready'
      ? `The model “${model.name}” is ${model.status}, so there is nothing to download yet`
      : !model.glbUrl
        ? 'The model has no GLB file on it'
        : null

  const qrMissing = !qr
    ? 'No QR code points at this product yet — create one in QR Codes'
    : !generated
      ? 'Generating…'
      : null

  const assets: Asset[] = [
    {
      key: 'glb',
      name: 'AR model',
      format: 'GLB',
      purpose: 'The universal 3D file — Android AR, the web viewer, and most 3D tools read it.',
      icon: <Box />,
      bytes: model && !glbMissing ? model.fileSizeBytes : null,
      href: glbMissing ? null : (model?.glbUrl ?? null),
      filename: `${base}.glb`,
      missing: glbMissing,
    },
    {
      key: 'usdz',
      name: 'iOS AR model',
      format: 'USDZ',
      purpose: 'Apple’s AR Quick Look format — this is the file an iPhone opens in AR.',
      icon: <Smartphone />,
      // The repository stores one size for the model as a whole, so a per-file
      // number here would be a guess dressed up as a fact.
      bytes: null,
      href: model?.usdzUrl ?? null,
      filename: `${base}.usdz`,
      missing: model?.usdzUrl ? null : 'No USDZ — iPhone AR needs one',
    },
    {
      key: 'image',
      name: 'Product image',
      format: 'Image',
      purpose: 'The photo on the public page — reuse it on menus, listings and social posts.',
      icon: <ImageIcon />,
      bytes: null,
      href: product.imageUrl,
      filename: `${base}-image`,
      missing: product.imageUrl ? null : 'No product image — add one on the product page',
    },
    {
      key: 'qr-png',
      name: 'QR code',
      format: 'PNG · 1024px',
      purpose: 'Drop straight into a design tool or send to a printer. Raster, so do not enlarge it.',
      icon: <QrCodeIcon />,
      bytes: generated?.pngBytes ?? null,
      href: generated?.pngUrl ?? null,
      filename: `${base}-qr.png`,
      missing: qrMissing,
    },
    {
      key: 'qr-svg',
      name: 'QR code',
      format: 'SVG · vector',
      purpose: 'Scales to any size without softening — use this for anything larger than a card.',
      icon: <FileImage />,
      bytes: generated?.svgBytes ?? null,
      href: generated?.svgUrl ?? null,
      filename: `${base}-qr.svg`,
      missing: qrMissing,
    },
  ]

  function openSheet() {
    setSheetOpen(true)
    // The sheet mounts below the fold on a phone; without this the button looks
    // like it did nothing.
    window.requestAnimationFrame(() => {
      sheetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="divide-y border-t">
          {assets.map((asset) => (
            <div
              key={asset.key}
              className="flex flex-wrap items-start gap-3 py-4 sm:flex-nowrap sm:items-center"
            >
              <div
                className={
                  asset.missing
                    ? 'text-muted-foreground/40 mt-0.5 shrink-0 [&_svg]:size-5'
                    : 'text-muted-foreground mt-0.5 shrink-0 [&_svg]:size-5'
                }
                aria-hidden
              >
                {asset.icon}
              </div>

              <div className="min-w-0 flex-1 basis-full space-y-1 sm:basis-auto">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{asset.name}</p>
                  <Badge variant={asset.missing ? 'muted' : 'secondary'}>{asset.format}</Badge>
                  {asset.bytes !== null && (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatBytes(asset.bytes)}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-sm">{asset.purpose}</p>
                {asset.missing && (
                  <p className="text-warning-foreground text-xs">{asset.missing}</p>
                )}
              </div>

              <div className="ml-auto shrink-0">
                {asset.href ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={asset.href} download={asset.filename}>
                      <Download className="size-3.5" aria-hidden />
                      Download
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    Unavailable
                  </Button>
                )}
              </div>
            </div>
          ))}

          {/* Not a file — it hands the browser's print dialog a laid-out sheet. */}
          <div className="flex flex-wrap items-start gap-3 py-4 sm:flex-nowrap sm:items-center">
            <div
              className={
                generated
                  ? 'text-muted-foreground mt-0.5 shrink-0 [&_svg]:size-5'
                  : 'text-muted-foreground/40 mt-0.5 shrink-0 [&_svg]:size-5'
              }
              aria-hidden
            >
              <Printer />
            </div>
            <div className="min-w-0 flex-1 basis-full space-y-1 sm:basis-auto">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">Print sheet</p>
                <Badge variant={generated ? 'secondary' : 'muted'}>A4 or table tent</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                A ready-to-print page with your branding, the price and the QR — no design tool
                needed.
              </p>
              {qrMissing && <p className="text-warning-foreground text-xs">{qrMissing}</p>}
            </div>
            <div className="ml-auto shrink-0">
              <Button size="sm" variant="outline" onClick={openSheet} disabled={!generated}>
                <Printer className="size-3.5" aria-hidden />
                Open
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!qr && (
        <EmptyState
          icon={<QrCodeIcon />}
          title="No QR code for this product"
          description="The QR downloads and the print sheet all start from a code. Create one pointing at this product and they light up here."
          action={
            <Button asChild size="sm">
              <Link href="/dashboard/qr">Create a QR code</Link>
            </Button>
          }
        />
      )}

      {generated && (
        <div ref={sheetRef}>
          {sheetOpen ? (
            <PrintSheet
              businessName={business.name}
              logoUrl={business.logoUrl}
              productName={product.name}
              priceMinor={product.priceMinor}
              currency={product.currency}
              qrDataUrl={generated.pngUrl}
              targetUrl={generated.target}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
