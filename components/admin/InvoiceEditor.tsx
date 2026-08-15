'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Plus, Printer, Trash2 } from 'lucide-react'
import {
  Alert, Button, Field, Input, Label, Select, Separator, Textarea,
} from '@/components/ui'
import { createInvoiceAction, recordPaymentAction } from '@/lib/actions/admin'
import { formatMoney, majorToMinor, minorToMajor } from '@/utils/money'
import type { ActionResult } from '@/lib/auth/errors'
import type { InvoiceItemKind } from '@/types/domain'

const KIND_LABELS: Record<InvoiceItemKind, string> = {
  subscription: 'Subscription',
  setup_fee: 'Setup fee',
  model: '3D model',
  custom: 'Custom',
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  razorpay: 'Razorpay',
  other: 'Other',
}

type Line = { key: string; description: string; amount: string; kind: InvoiceItemKind }

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  )
}

/** Rupees typed into a form to integer paise, tolerating an empty or junk field. */
function toMinor(raw: string): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? majorToMinor(value) : 0
}

export default function InvoiceEditor({
  businesses,
  defaultTaxName,
  defaultTaxPercent,
}: {
  businesses: Array<{ id: string; name: string }>
  defaultTaxName: string
  defaultTaxPercent: number
}) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    createInvoiceAction,
    null,
  )
  const formRef = useRef<HTMLFormElement>(null)
  const nextKey = useRef(1)
  const [lines, setLines] = useState<Line[]>([
    { key: 'line-0', description: '', amount: '', kind: 'custom' },
  ])
  const [discount, setDiscount] = useState('0')
  const [taxPercent, setTaxPercent] = useState(String(defaultTaxPercent))

  // A filled-in form left standing after a successful save is how an admin
  // raises the same invoice twice.
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset()
      setLines([{ key: `line-${nextKey.current++}`, description: '', amount: '', kind: 'custom' }])
      setDiscount('0')
      setTaxPercent(String(defaultTaxPercent))
    }
  }, [state, defaultTaxPercent])

  const patch = (key: string, changes: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...changes } : l)))

  // Mirrors exactly what the action keeps: a line without a description or an
  // amount is dropped, so the preview equals the invoice that gets stored.
  const subtotalMinor = lines
    .filter((l) => l.description.trim() && toMinor(l.amount) > 0)
    .reduce((sum, l) => sum + toMinor(l.amount), 0)
  const discountMinor = Math.min(toMinor(discount), subtotalMinor)
  const percent = Number(taxPercent)
  const taxMinor = Math.round(
    ((subtotalMinor - discountMinor) * (Number.isFinite(percent) ? percent : 0)) / 100,
  )
  const totalMinor = subtotalMinor - discountMinor + taxMinor

  return (
    <form ref={formRef} action={action} className="space-y-5">
      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">Invoice created and marked as sent.</Alert>}

      <Field label="Business" htmlFor="businessId" required>
        <Select id="businessId" name="businessId" defaultValue="" required>
          <option value="" disabled>
            Choose a business
          </option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="space-y-2">
        <Label>Line items</Label>
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={line.key} className="grid gap-2 sm:grid-cols-[1fr_8rem_9rem_auto]">
              <Input
                name="itemDescription"
                value={line.description}
                onChange={(e) => patch(line.key, { description: e.target.value })}
                placeholder="What is being charged"
                aria-label={`Line ${index + 1} description`}
              />
              <Input
                name="itemAmount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={line.amount}
                onChange={(e) => patch(line.key, { amount: e.target.value })}
                placeholder="0.00"
                aria-label={`Line ${index + 1} amount in rupees`}
              />
              <Select
                name="itemKind"
                value={line.kind}
                onChange={(e) => patch(line.key, { kind: e.target.value as InvoiceItemKind })}
                aria-label={`Line ${index + 1} type`}
              >
                {(Object.keys(KIND_LABELS) as InvoiceItemKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                disabled={lines.length === 1}
                aria-label={`Remove line ${index + 1}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setLines((prev) => [
              ...prev,
              { key: `line-${nextKey.current++}`, description: '', amount: '', kind: 'custom' },
            ])
          }
        >
          <Plus className="size-3.5" aria-hidden />
          Add line
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Discount (₹)" htmlFor="discount">
          <Input
            id="discount"
            name="discount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>
        <Field label="Tax name" htmlFor="taxName">
          <Input id="taxName" name="taxName" defaultValue={defaultTaxName} placeholder="GST" />
        </Field>
        <Field label="Tax %" htmlFor="taxPercent" hint="From platform tax settings.">
          <Input
            id="taxPercent"
            name="taxPercent"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={taxPercent}
            onChange={(e) => setTaxPercent(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Due date" htmlFor="dueDate" required>
        <Input id="dueDate" name="dueDate" type="date" required />
      </Field>

      <Field label="Notes" htmlFor="notes" hint="Printed on the invoice.">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>

      <div className="bg-muted/40 space-y-1.5 rounded-lg p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">
            {formatMoney({ amount: subtotalMinor, currency: 'INR' })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Discount</span>
          <span className="tabular-nums">
            −{formatMoney({ amount: discountMinor, currency: 'INR' })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax</span>
          <span className="tabular-nums">{formatMoney({ amount: taxMinor, currency: 'INR' })}</span>
        </div>
        <Separator className="my-1" />
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span className="tabular-nums">
            {formatMoney({ amount: totalMinor, currency: 'INR' })}
          </span>
        </div>
      </div>

      <SubmitButton label="Create invoice" pendingLabel="Creating…" />
    </form>
  )
}

export function RecordPaymentForm({
  invoiceId,
  businessId,
  outstandingMinor,
}: {
  invoiceId: string
  businessId: string
  outstandingMinor: number
}) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    recordPaymentAction,
    null,
  )

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="businessId" value={businessId} />

      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">Payment recorded.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Amount (₹)"
          htmlFor="amount"
          required
          hint="Defaults to the full outstanding balance."
        >
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
            defaultValue={minorToMajor(outstandingMinor).toFixed(2)}
            required
          />
        </Field>
        <Field label="Method" htmlFor="method" required>
          <Select id="method" name="method" defaultValue="bank_transfer">
            {Object.keys(METHOD_LABELS).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Reference" htmlFor="reference" hint="UTR, cheque number or transaction id.">
        <Input id="reference" name="reference" />
      </Field>

      <Field label="Notes" htmlFor="paymentNotes">
        <Textarea id="paymentNotes" name="notes" rows={2} />
      </Field>

      <SubmitButton label="Record payment" pendingLabel="Recording…" />
    </form>
  )
}

/** Print is a browser API, so the trigger has to live on the client. */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      Print
    </Button>
  )
}
