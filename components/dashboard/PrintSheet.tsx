'use client'

import { useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Select } from '@/components/ui'
import { formatMoney, type CurrencyCode } from '@/utils/money'

type SheetSize = 'a4' | 'tent'

type SizeSpec = {
  label: string
  hint: string
  /** Paper dimensions, also handed to @page so the printer picks the right stock. */
  width: string
  height: string
  padding: string
  qr: string
  nameSize: string
  priceSize: string
  brandSize: string
  ctaSize: string
  /** Screen preview only — the printed sheet uses the mm values above. */
  ratio: string
}

const SIZES: Record<SheetSize, SizeSpec> = {
  a4: {
    label: 'A4 poster',
    hint: '210 × 297 mm — a shop window, a wall, a counter stand.',
    width: '210mm',
    height: '297mm',
    padding: '20mm',
    qr: '110mm',
    nameSize: '30pt',
    priceSize: '20pt',
    brandSize: '14pt',
    ctaSize: '13pt',
    ratio: '210 / 297',
  },
  tent: {
    label: 'Table tent',
    hint: '100 × 150 mm — folds onto a restaurant or shop table.',
    width: '100mm',
    height: '150mm',
    padding: '8mm',
    qr: '58mm',
    nameSize: '16pt',
    priceSize: '12pt',
    brandSize: '9pt',
    ctaSize: '8pt',
    ratio: '100 / 150',
  },
}

export default function PrintSheet({
  businessName,
  logoUrl,
  productName,
  priceMinor,
  currency,
  qrDataUrl,
  targetUrl,
}: {
  businessName: string
  logoUrl: string | null
  productName: string
  priceMinor: number | null
  currency: CurrencyCode
  qrDataUrl: string
  targetUrl: string
}) {
  const [size, setSize] = useState<SheetSize>('a4')
  const sheetRef = useRef<HTMLDivElement>(null)
  const spec = SIZES[size]

  function handlePrint() {
    const sheet = sheetRef.current
    if (!sheet) return

    sheet.classList.add('is-printing')
    document.body.classList.add('genie-printing')

    const restore = () => {
      sheet.classList.remove('is-printing')
      document.body.classList.remove('genie-printing')
    }
    // Safari does not block on print() and does not reliably fire afterprint, so
    // the timeout is the restore path that actually runs there.
    window.addEventListener('afterprint', restore, { once: true })
    window.setTimeout(restore, 2000)
    window.print()
  }

  return (
    <Card>
      <style>{`
        @page { size: ${spec.width} ${spec.height}; margin: 0; }

        @media print {
          /* Printing the sheet must not print the dashboard around it. Everything
             is hidden, then only the sheet is lifted back into view. */
          body.genie-printing * { visibility: hidden !important; }
          body.genie-printing .genie-print-sheet.is-printing,
          body.genie-printing .genie-print-sheet.is-printing * { visibility: visible !important; }

          body.genie-printing .genie-print-sheet.is-printing {
            position: fixed;
            top: 0;
            left: 0;
            width: ${spec.width};
            height: ${spec.height};
            max-width: none;
            aspect-ratio: auto;
            padding: ${spec.padding};
            border: 0;
            border-radius: 0;
            box-shadow: none;
            background: white;
            color: black;
            break-inside: avoid;
          }
          body.genie-printing .genie-print-sheet.is-printing .genie-print-qr {
            width: ${spec.qr};
            height: ${spec.qr};
          }
          body.genie-printing .genie-print-sheet.is-printing .genie-print-name { font-size: ${spec.nameSize}; }
          body.genie-printing .genie-print-sheet.is-printing .genie-print-price { font-size: ${spec.priceSize}; }
          body.genie-printing .genie-print-sheet.is-printing .genie-print-brand { font-size: ${spec.brandSize}; }
          body.genie-printing .genie-print-sheet.is-printing .genie-print-cta { font-size: ${spec.ctaSize}; }
          body.genie-printing .genie-print-sheet.is-printing .genie-print-url { display: none; }
        }
      `}</style>

      <CardHeader>
        <CardTitle className="text-base">Print sheet</CardTitle>
        <CardDescription>
          Print it, fold it if it is a tent, and put it where customers already look. The preview
          below is exactly what comes out.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1 space-y-1.5">
            <label className="text-sm leading-none font-medium" htmlFor="sheet-size">
              Size
            </label>
            <Select
              id="sheet-size"
              value={size}
              onChange={(e) => setSize(e.target.value as SheetSize)}
            >
              {(Object.keys(SIZES) as SheetSize[]).map((key) => (
                <option key={key} value={key}>
                  {SIZES[key].label}
                </option>
              ))}
            </Select>
            <p className="text-muted-foreground text-xs">{spec.hint}</p>
          </div>

          <Button onClick={handlePrint}>
            <Printer className="size-4" aria-hidden />
            Print
          </Button>
        </div>

        <div className="bg-muted/40 flex justify-center rounded-xl p-4">
          <div
            ref={sheetRef}
            className="genie-print-sheet bg-background flex w-full max-w-64 flex-col items-center justify-center gap-3 rounded-lg border p-5 text-center"
            style={{ aspectRatio: spec.ratio }}
          >
            <div className="genie-print-brand flex items-center gap-2 text-sm font-semibold">
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="size-6 rounded object-contain" />
              )}
              <span>{businessName}</span>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={`QR code linking to ${productName} in AR`}
              className="genie-print-qr size-32 max-w-full"
            />

            <p className="genie-print-name text-lg leading-tight font-bold">{productName}</p>
            {priceMinor !== null && (
              <p className="genie-print-price text-sm font-medium">
                {formatMoney({ amount: priceMinor, currency })}
              </p>
            )}
            <p className="genie-print-cta text-xs tracking-[0.14em] uppercase">Scan to view in AR</p>
            <p className="genie-print-url text-muted-foreground w-full truncate text-[10px]">
              {targetUrl}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
