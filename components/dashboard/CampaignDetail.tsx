'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, QrCode } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Input } from '@/components/ui'
import { cn } from '@/lib/utils'
import {
  setCampaignProductsAction,
  createCampaignQrAction,
  updateCampaignAction,
} from '@/lib/actions/campaigns'
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_VARIANTS,
  type Campaign,
} from '@/lib/campaigns/status'

export type CampaignProductOption = {
  id: string
  name: string
  imageUrl: string | null
  status: string
}

export type CampaignQr = {
  id: string
  label: string
  url: string
  scanCount: number
  isActive: boolean
}

/**
 * Campaign membership, codes and dates.
 *
 * Membership is edited as a set and written wholesale — the array's index
 * becomes sort_order, matching the repository's replace-not-diff contract.
 */
export default function CampaignDetail({
  campaign,
  products,
  selectedIds,
  qrCodes,
  publicUrl,
}: {
  campaign: Campaign
  products: CampaignProductOption[]
  selectedIds: string[]
  qrCodes: CampaignQr[]
  publicUrl: string
}) {
  const [selected, setSelected] = useState<string[]>(selectedIds)
  const [qrLabel, setQrLabel] = useState('')
  const [pending, startTransition] = useTransition()

  const dirty =
    selected.length !== selectedIds.length || selected.some((id, i) => selectedIds[i] !== id)

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    )
  }

  const save = () => {
    startTransition(async () => {
      const result = await setCampaignProductsAction(campaign.id, selected)
      toast[result.ok ? 'success' : 'error'](
        result.ok ? `${selected.length} product${selected.length === 1 ? '' : 's'} in this campaign.` : result.error,
      )
    })
  }

  const mintQr = () => {
    startTransition(async () => {
      const result = await createCampaignQrAction(campaign.id, qrLabel)
      if (result.ok) {
        setQrLabel('')
        toast.success('QR code created.')
      } else {
        toast.error(result.error)
      }
    })
  }

  const setDates = (field: 'startsAt' | 'endsAt', value: string) => {
    startTransition(async () => {
      const result = await updateCampaignAction(campaign.id, { [field]: value })
      if (!result.ok) toast.error(result.error)
    })
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
            <Badge variant={CAMPAIGN_STATUS_VARIANTS[campaign.status]}>
              {CAMPAIGN_STATUS_LABELS[campaign.status]}
            </Badge>
          </div>
          {campaign.goal && <p className="text-muted-foreground text-sm">{campaign.goal}</p>}
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href={publicUrl} target="_blank" rel="noopener noreferrer">
            View public page
          </Link>
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Products in this campaign</h2>
              <p className="text-muted-foreground text-xs">
                {selected.length} selected. Order here is the order customers see.
              </p>
            </div>
            <Button size="sm" onClick={save} disabled={!dirty || pending}>
              {pending ? 'Saving…' : 'Save selection'}
            </Button>
          </div>

          {products.length === 0 ? (
            <p className="text-muted-foreground mt-4 text-sm">
              You have no products yet.{' '}
              <Link href="/dashboard/create" className="underline">
                Create one
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {products.map((product) => {
                const index = selected.indexOf(product.id)
                const isSelected = index >= 0
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => toggle(product.id)}
                      aria-pressed={isSelected}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors',
                        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-accent/50',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-6 shrink-0 place-items-center rounded-md border text-[10px] font-semibold',
                          isSelected ? 'bg-primary text-primary-foreground border-transparent' : '',
                        )}
                      >
                        {isSelected ? index + 1 : ''}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{product.name}</span>
                        <span className="text-muted-foreground text-xs capitalize">
                          {product.status}
                        </span>
                      </span>
                      {isSelected && <Check className="text-primary size-4 shrink-0" aria-hidden />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Dates</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Status is worked out from these every time the page loads, so a campaign is never live
              past its own end date.
            </p>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="text-muted-foreground text-xs">Starts</span>
                <Input
                  type="datetime-local"
                  defaultValue={toLocalInput(campaign.startsAt)}
                  onChange={(e) => setDates('startsAt', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground text-xs">Ends</span>
                <Input
                  type="datetime-local"
                  defaultValue={toLocalInput(campaign.endsAt)}
                  onChange={(e) => setDates('endsAt', e.target.value)}
                />
              </label>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold">QR codes</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              These point at the campaign, not at a product — change what the campaign contains and
              every printed code follows.
            </p>

            <div className="mt-3 flex gap-2">
              <Input
                value={qrLabel}
                onChange={(e) => setQrLabel(e.target.value)}
                placeholder="Table tent"
                aria-label="QR code label"
              />
              <Button size="sm" onClick={mintQr} disabled={pending}>
                Create
              </Button>
            </div>

            {qrCodes.length === 0 ? (
              <p className="text-muted-foreground mt-3 text-xs">No codes yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {qrCodes.map((code) => (
                  <li key={code.id} className="flex items-center gap-2 text-sm">
                    <QrCode className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{code.label || 'Untitled'}</span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {code.scanCount.toLocaleString()} scans
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <Button asChild variant="ghost" size="sm" className="mt-3 w-full">
              <Link href="/dashboard/qr">Manage and print codes</Link>
            </Button>
          </Card>
        </div>
      </div>
    </div>
  )
}

/**
 * ISO → the `datetime-local` format, in the viewer's own zone.
 *
 * `slice(0, 16)` on an ISO string is the common shortcut and it is wrong: ISO
 * is UTC, so a campaign starting 18:00 IST would display as 12:30 to the
 * person who just typed 18:00.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
