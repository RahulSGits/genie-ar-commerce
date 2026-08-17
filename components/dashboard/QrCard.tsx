'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import QRCode from 'qrcode'
import { Download, Printer, RefreshCw, ScanLine, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardContent, Separator, Switch } from '@/components/ui'
import { deleteQrAction, regenerateQrAction, toggleQrAction } from '@/lib/actions/dashboard'
import { formatDateTime, slugify } from '@/lib/utils'
import { formatMoney, type CurrencyCode } from '@/utils/money'
import type { QrCode as QrCodeRecord } from '@/types/domain'

export type QrCardProduct = {
  name: string
  priceMinor: number | null
  currency: CurrencyCode
}

const DESTINATION_LABELS: Record<QrCodeRecord['destination'], string> = {
  ar: 'AR experience',
  product: 'Product page',
  menu: 'Menu',
  website: 'Website',
  custom: 'Custom URL',
}

export default function QrCard({
  code,
  targetPath,
  product,
  timezone,
}: {
  code: QrCodeRecord
  /** Path half of the scan URL. The origin is only knowable in the browser. */
  targetPath: string
  product: QrCardProduct | null
  timezone: string
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [active, setActive] = useState(code.isActive)
  const [pending, startTransition] = useTransition()
  const sheetRef = useRef<HTMLDivElement>(null)

  // Server revalidation is the source of truth; the local flag only smooths the
  // gap between the tap and the round trip.
  useEffect(() => setActive(code.isActive), [code.isActive])

  useEffect(() => {
    // The operator may be on localhost, a LAN IP or the live domain — the code
    // has to encode the host their phone will actually resolve.
    const url = `${window.location.origin}${targetPath}`
    setTarget(url)

    let cancelled = false
    QRCode.toDataURL(url, { width: 512, margin: 1 })
      .then((png) => {
        if (!cancelled) setDataUrl(png)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [targetPath])

  function handlePrint() {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.classList.add('is-printing')
    document.body.classList.add('qr-printing')

    const restore = () => {
      sheet.classList.remove('is-printing')
      document.body.classList.remove('qr-printing')
    }
    // Safari never blocks on print() and does not always fire afterprint, so
    // the timeout is the one that actually runs there.
    window.addEventListener('afterprint', restore, { once: true })
    window.setTimeout(restore, 2000)
    window.print()
  }

  function handleRegenerate() {
    if (
      !window.confirm(
        `Regenerate "${code.label}"?\n\nA new code is issued immediately and every printed or shared copy of the old one stops working. Anything already on a table, menu or shopfront will need reprinting.`,
      )
    ) {
      return
    }
    startTransition(() => {
      void regenerateQrAction(code.id)
    })
  }

  function handleDelete() {
    if (!window.confirm(`Delete "${code.label}"? Scans of this code will stop resolving.`)) return
    startTransition(() => {
      void deleteQrAction(code.id)
    })
  }

  return (
    <Card className={active ? undefined : 'opacity-70'}>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-4">
          <div className="bg-background grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border p-1">
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dataUrl} alt={`QR code for ${code.label}`} className="size-full" />
            ) : (
              <ScanLine className="text-muted-foreground/40 size-6" aria-hidden />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate font-medium">{code.label}</p>
              <Switch
                checked={active}
                disabled={pending}
                onCheckedChange={(v) => {
                  setActive(v)
                  startTransition(() => {
                    void toggleQrAction(code.id, v)
                  })
                }}
              />
            </div>

            {/*
              Badges are whitespace-nowrap, so a long product or campaign name
              cannot shrink and pushes the whole card past the viewport on a
              narrow phone — flex-wrap moves a badge to the next line but never
              makes one narrower than its text. `max-w-full truncate` lets the
              badge itself give way instead.
            */}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{DESTINATION_LABELS[code.destination]}</Badge>
              {product && (
                <Badge variant="outline" className="max-w-full truncate">
                  {product.name}
                </Badge>
              )}
              {code.campaign && (
                <Badge variant="muted" className="max-w-full truncate">
                  {code.campaign}
                </Badge>
              )}
              {!active && <Badge variant="warning">Paused</Badge>}
            </div>

            <p className="text-muted-foreground truncate text-xs" title={target}>
              {target || `…${targetPath}`}
            </p>
            {code.destination === 'custom' && code.customUrl && (
              <p className="text-muted-foreground truncate text-xs" title={code.customUrl}>
                Redirects to {code.customUrl}
              </p>
            )}
          </div>
        </div>

        <Separator />

        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Scans</span>
          <span className="font-medium tabular-nums">
            {code.scanCount.toLocaleString('en-IN')}
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {code.lastScanAt ? `last ${formatDateTime(code.lastScanAt, timezone)}` : 'never scanned'}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {dataUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={dataUrl} download={`${slugify(code.label) || 'qr-code'}.png`}>
                <Download className="size-3.5" aria-hidden />
                PNG
              </a>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handlePrint} disabled={!dataUrl}>
            <Printer className="size-3.5" aria-hidden />
            Print
          </Button>
          <Button size="sm" variant="ghost" onClick={handleRegenerate} disabled={pending}>
            <RefreshCw className="size-3.5" aria-hidden />
            Regenerate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={pending}
            className="text-muted-foreground hover:text-destructive ml-auto"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </Button>
        </div>
      </CardContent>

      <div ref={sheetRef} className="qr-print-sheet" aria-hidden>
        {dataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="" className="qr-print-image" />
        )}
        <p className="qr-print-title">{product?.name ?? code.label}</p>
        {product && product.priceMinor !== null && (
          <p className="qr-print-price">
            {formatMoney({ amount: product.priceMinor, currency: product.currency })}
          </p>
        )}
        <p className="qr-print-cta">Scan to view in AR</p>
      </div>
    </Card>
  )
}
