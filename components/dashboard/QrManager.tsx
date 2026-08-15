'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Plus, QrCode as QrCodeIcon } from 'lucide-react'
import {
  Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState,
  Field, Input, Select,
} from '@/components/ui'
import { createQrAction } from '@/lib/actions/dashboard'
import QrCard, { type QrCardProduct } from '@/components/dashboard/QrCard'
import type { ActionResult } from '@/lib/auth/errors'
import type { QrCode, QrDestination } from '@/types/domain'

export type QrProductOption = QrCardProduct & { id: string }

/** A code paired with the path half of its scan URL, built server-side. */
export type QrRow = { code: QrCode; targetPath: string }

const DESTINATIONS: { value: QrDestination; label: string; hint: string }[] = [
  { value: 'ar', label: 'AR experience', hint: 'Opens the product straight in AR. Pick a product above.' },
  { value: 'product', label: 'Product page', hint: 'Opens the product page with the AR button on it.' },
  { value: 'menu', label: 'Menu', hint: 'Opens your full catalogue. Good for table tents.' },
  { value: 'website', label: 'Website', hint: 'Sends scanners to the website on your business profile.' },
  { value: 'custom', label: 'Custom URL', hint: 'Any URL you control. Re-pointable without reprinting.' },
]

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      <Plus className="size-4" aria-hidden />
      {pending ? 'Creating…' : 'Create code'}
    </Button>
  )
}

export default function QrManager({
  rows,
  products,
  timezone,
}: {
  rows: QrRow[]
  products: QrProductOption[]
  timezone: string
}) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(createQrAction, null)
  const [destination, setDestination] = useState<QrDestination>('ar')
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset()
      setDestination('ar')
    }
  }, [state])

  const byId = new Map(products.map((p) => [p.id, p]))
  const activeHint = DESTINATIONS.find((d) => d.value === destination)?.hint

  return (
    <div className="space-y-6">
      <style>{`
        .qr-print-sheet { display: none; }

        @media print {
          @page { margin: 12mm; }

          /* Printing one code must not print the dashboard around it. Everything
             is hidden and only the chosen sheet is lifted back into view. */
          body.qr-printing * { visibility: hidden !important; }
          body.qr-printing .qr-print-sheet.is-printing,
          body.qr-printing .qr-print-sheet.is-printing * { visibility: visible !important; }

          body.qr-printing .qr-print-sheet.is-printing {
            display: flex !important;
            position: fixed;
            inset: 0;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 6mm;
            background: white;
            color: black;
            text-align: center;
            break-inside: avoid;
          }
          .qr-print-sheet .qr-print-image { width: 90mm; height: 90mm; }
          .qr-print-sheet .qr-print-title { font-size: 22pt; font-weight: 700; }
          .qr-print-sheet .qr-print-price { font-size: 16pt; }
          .qr-print-sheet .qr-print-cta {
            font-size: 11pt;
            letter-spacing: 0.14em;
            text-transform: uppercase;
          }
        }
      `}</style>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New QR code</CardTitle>
          <CardDescription>
            Every code points at a short link you can re-target later, so a printed sticker never
            becomes dead paper.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form ref={formRef} action={action} className="space-y-4">
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            {state?.ok && <Alert variant="success">Code created. Download or print it below.</Alert>}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Label" htmlFor="label" required hint="Where this code will live, e.g. Table 4.">
                <Input id="label" name="label" required maxLength={80} placeholder="Table 4 tent card" />
              </Field>

              <Field label="Product" htmlFor="productId" hint="Leave blank for a code that covers the whole business.">
                <Select id="productId" name="productId" defaultValue="">
                  <option value="">No product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Destination" htmlFor="destination" required hint={activeHint}>
                <Select
                  id="destination"
                  name="destination"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value as QrDestination)}
                >
                  {DESTINATIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Campaign" htmlFor="campaign" hint="Optional tag for reporting, e.g. diwali-2026.">
                <Input id="campaign" name="campaign" maxLength={60} placeholder="diwali-2026" />
              </Field>

              {destination === 'custom' && (
                <Field
                  label="Custom URL"
                  htmlFor="customUrl"
                  required
                  className="sm:col-span-2"
                  hint="Include https://."
                >
                  <Input
                    id="customUrl"
                    name="customUrl"
                    type="url"
                    required
                    placeholder="https://example.com/offer"
                  />
                </Field>
              )}
            </div>

            <SubmitButton />
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={<QrCodeIcon />}
          title="No QR codes yet"
          description="Create one above, print it, and put it where customers already look — a table tent, a shelf edge, a shop window."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map(({ code, targetPath }) => (
            <QrCard
              key={code.id}
              code={code}
              targetPath={targetPath}
              product={code.productId ? (byId.get(code.productId) ?? null) : null}
              timezone={timezone}
            />
          ))}
        </div>
      )}
    </div>
  )
}
