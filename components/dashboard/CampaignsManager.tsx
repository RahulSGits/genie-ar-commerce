'use client'

import { useActionState, useState, useTransition } from 'react'
import Link from 'next/link'
import { Megaphone, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Badge, Button, Card, EmptyState, Field, Input, Textarea,
} from '@/components/ui'
import {
  createCampaignAction,
  updateCampaignAction,
  deleteCampaignAction,
} from '@/lib/actions/campaigns'
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_VARIANTS,
  type Campaign,
} from '@/lib/db/repositories/campaigns'

/**
 * Campaign list and creation (§21, §31).
 *
 * Status is rendered from `campaign.status`, which the repository derives from
 * the dates on every read — so a campaign whose end date passed shows as
 * "Ended" the instant it is true, with no job needing to have run.
 */

export default function CampaignsManager({ campaigns }: { campaigns: Campaign[] }) {
  const [creating, setCreating] = useState(false)
  const [pending, startTransition] = useTransition()

  const [state, formAction, submitting] = useActionState(createCampaignAction, null)

  const setStatus = (id: string, status: string) => {
    startTransition(async () => {
      const result = await updateCampaignAction(id, { status })
      toast[result.ok ? 'success' : 'error'](
        result.ok ? 'Campaign updated.' : result.error,
      )
    })
  }

  const remove = (id: string, name: string) => {
    if (!confirm(`Delete “${name}”? Its QR codes will stop resolving.`)) return
    startTransition(async () => {
      const result = await deleteCampaignAction(id)
      toast[result.ok ? 'success' : 'error'](result.ok ? 'Campaign deleted.' : result.error)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}
        </p>
        <Button onClick={() => setCreating((open) => !open)} size="sm">
          <Plus className="size-4" aria-hidden />
          New campaign
        </Button>
      </div>

      {creating && (
        <Card className="p-5">
          <form action={formAction} className="space-y-4">
            <Field label="Name" htmlFor="campaign-name">
              <Input
                id="campaign-name"
                name="name"
                required
                placeholder="Diwali Collection 2026"
                maxLength={120}
              />
            </Field>

            <Field
              label="What is this campaign for?"
              htmlFor="campaign-goal"
              hint="Shown on the campaign page and in reports."
            >
              <Input id="campaign-goal" name="goal" placeholder="Drive festive dessert orders" />
            </Field>

            <Field label="Description" htmlFor="campaign-description">
              <Textarea id="campaign-description" name="description" rows={2} maxLength={2000} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" htmlFor="campaign-start" hint="Leave blank to start now.">
                <Input id="campaign-start" name="startsAt" type="datetime-local" />
              </Field>
              <Field label="Ends" htmlFor="campaign-end" hint="Leave blank to run indefinitely.">
                <Input id="campaign-end" name="endsAt" type="datetime-local" />
              </Field>
            </div>

            {state?.ok === false && (
              <p className="text-destructive text-sm" role="alert">
                {state.error}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create campaign'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {campaigns.length === 0 && !creating ? (
        <EmptyState
          icon={<Megaphone />}
          title="No campaigns yet"
          description="A campaign groups products behind one QR code and a dated landing page — so you can measure a promotion instead of guessing at it."
          action={<Button onClick={() => setCreating(true)}>Create your first campaign</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/dashboard/campaigns/${campaign.id}`}
                  className="min-w-0 font-medium hover:underline"
                >
                  {campaign.name}
                </Link>
                <Badge variant={CAMPAIGN_STATUS_VARIANTS[campaign.status]}>
                  {CAMPAIGN_STATUS_LABELS[campaign.status]}
                </Badge>
              </div>

              {campaign.goal && (
                <p className="text-muted-foreground line-clamp-2 text-sm">{campaign.goal}</p>
              )}

              <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <dt className="text-muted-foreground">Products</dt>
                  <dd className="font-semibold tabular-nums">{campaign.productCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Codes</dt>
                  <dd className="font-semibold tabular-nums">{campaign.qrCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Scans</dt>
                  <dd className="font-semibold tabular-nums">{campaign.scans.toLocaleString()}</dd>
                </div>
              </dl>

              <p className="text-muted-foreground text-xs">{describeWindow(campaign)}</p>

              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/dashboard/campaigns/${campaign.id}`}>Manage</Link>
                </Button>
                {campaign.storedStatus === 'live' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setStatus(campaign.id, 'paused')}
                  >
                    Pause
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setStatus(campaign.id, 'live')}
                  >
                    {campaign.storedStatus === 'draft' ? 'Launch' : 'Resume'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => remove(campaign.id, campaign.name)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function describeWindow(campaign: Campaign): string {
  const format = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  if (campaign.startsAt && campaign.endsAt) {
    return `${format(campaign.startsAt)} → ${format(campaign.endsAt)}`
  }
  if (campaign.endsAt) return `Ends ${format(campaign.endsAt)}`
  if (campaign.startsAt) return `From ${format(campaign.startsAt)}`
  return 'No dates set — runs until paused'
}
