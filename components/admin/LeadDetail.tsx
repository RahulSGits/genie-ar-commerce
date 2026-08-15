'use client'

import { useActionState, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Building2, Check, Mail, MapPin, MessageSquare,
  Phone, Plus, Trash2,
} from 'lucide-react'
import {
  Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  EmptyState, Field, Input, Label, Select, Separator, Textarea,
} from '@/components/ui'
import {
  addLeadNoteAction, addLeadTaskAction, completeTaskAction, convertLeadAction,
  deleteLeadAction, moveLeadStageAction,
} from '@/lib/actions/admin'
import {
  CRM_STAGES, CRM_STAGE_LABELS,
  type CrmActivity, type CrmLead, type CrmNote, type CrmTask, type SubscriptionPlan,
} from '@/types/domain'
import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS } from '@/config/terminology'
import type { ActionResult } from '@/lib/auth/errors'
import { formatMoney } from '@/utils/money'
import { formatDate, formatDateTime } from '@/lib/utils'

export default function LeadDetail({
  lead,
  notes,
  tasks,
  activity,
  plans,
}: {
  lead: CrmLead
  notes: CrmNote[]
  tasks: CrmTask[]
  activity: CrmActivity[]
  plans: SubscriptionPlan[]
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <ContactCard lead={lead} />
        <NotesCard leadId={lead.id} notes={notes} />
        <ActivityCard activity={activity} />
      </div>

      <div className="space-y-4">
        <StageCard lead={lead} />
        <TasksCard leadId={lead.id} tasks={tasks} />
        <ConvertCard lead={lead} plans={plans} />
        <DangerCard leadId={lead.id} businessName={lead.businessName} />
      </div>
    </div>
  )
}

/* ── contact ────────────────────────────────────────────────────────────── */

function ContactCard({ lead }: { lead: CrmLead }) {
  const rows: Array<[string, string | null]> = [
    ['Contact', lead.name],
    ['Business type', lead.businessType],
    ['City', lead.city],
    ['Source', lead.source],
    ['Expected value', formatMoney({ amount: lead.expectedValueMinor, currency: 'INR' })],
    ['Next follow-up', lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : null],
    ['Last contact', lead.lastContactAt ? formatDateTime(lead.lastContactAt) : null],
    ['Added', formatDate(lead.createdAt)],
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{lead.businessName}</CardTitle>
        <CardDescription>Everything captured about this prospect so far.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {lead.phone && (
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${lead.phone}`}>
                <Phone className="size-4" aria-hidden />
                {lead.phone}
              </a>
            </Button>
          )}
          {lead.email && (
            <Button asChild size="sm" variant="outline">
              <a href={`mailto:${lead.email}`}>
                <Mail className="size-4" aria-hidden />
                {lead.email}
              </a>
            </Button>
          )}
          {lead.website && (
            <Button asChild size="sm" variant="outline">
              <a href={lead.website} target="_blank" rel="noreferrer">
                <MapPin className="size-4" aria-hidden />
                Website
              </a>
            </Button>
          )}
        </div>

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 border-b py-1.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="truncate text-sm">{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

/* ── stage ──────────────────────────────────────────────────────────────── */

function StageCard({ lead }: { lead: CrmLead }) {
  const [stage, setStage] = useState(lead.stage)
  const [pending, startTransition] = useTransition()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pipeline stage</CardTitle>
      </CardHeader>
      <CardContent>
        <Field label="Stage" htmlFor="stage" hint="Every change is written to the activity trail.">
          <Select
            id="stage"
            value={stage}
            disabled={pending}
            onChange={(event) => {
              const next = event.target.value as (typeof CRM_STAGES)[number]
              setStage(next)
              startTransition(() => {
                void moveLeadStageAction(lead.id, next)
              })
            }}
          >
            {CRM_STAGES.map((option) => (
              <option key={option} value={option}>
                {CRM_STAGE_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
      </CardContent>
    </Card>
  )
}

/* ── notes ──────────────────────────────────────────────────────────────── */

function NotesCard({ leadId, notes }: { leadId: string; notes: CrmNote[] }) {
  const [draft, setDraft] = useState('')
  const [pending, startTransition] = useTransition()

  function submit() {
    const body = draft.trim()
    if (!body) return
    startTransition(async () => {
      await addLeadNoteAction(leadId, body)
      setDraft('')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notes</CardTitle>
        <CardDescription>What was said, agreed or promised.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="note-body">Add a note</Label>
          <Textarea
            id="note-body"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Owner wants a demo at the Andheri outlet next Tuesday."
          />
          <Button size="sm" onClick={submit} disabled={pending || !draft.trim()}>
            {pending ? 'Saving…' : 'Add note'}
          </Button>
        </div>

        <Separator />

        {notes.length === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title="No notes yet"
            description="Write down what happened on the call — future you will need it."
            className="border-0"
          />
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="border-b pb-3 last:border-0 last:pb-0">
                <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {note.authorName ?? 'Unknown'} · {formatDateTime(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ── tasks ──────────────────────────────────────────────────────────────── */

function TasksCard({ leadId, tasks }: { leadId: string; tasks: CrmTask[] }) {
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [pending, startTransition] = useTransition()

  function add() {
    const trimmed = title.trim()
    if (!trimmed) return
    startTransition(async () => {
      await addLeadTaskAction(leadId, trimmed, dueAt)
      setTitle('')
      setDueAt('')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tasks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Field label="Task" htmlFor="task-title">
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Send the proposal"
            />
          </Field>
          <Field label="Due" htmlFor="task-due">
            <Input
              id="task-due"
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Field>
          <Button size="sm" variant="outline" onClick={add} disabled={pending || !title.trim()}>
            <Plus className="size-4" aria-hidden />
            Add task
          </Button>
        </div>

        {tasks.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">Nothing scheduled.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-2 border-b pb-2 last:border-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className={task.completedAt ? 'text-muted-foreground text-sm line-through' : 'text-sm'}>
                    {task.title}
                  </p>
                  {task.dueAt && (
                    <p className="text-muted-foreground text-xs">Due {formatDate(task.dueAt)}</p>
                  )}
                </div>
                {task.completedAt ? (
                  <Badge variant="success">Done</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Complete ${task.title}`}
                    onClick={() =>
                      startTransition(() => {
                        void completeTaskAction(task.id)
                      })
                    }
                  >
                    <Check className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ── activity ───────────────────────────────────────────────────────────── */

function ActivityCard({ activity }: { activity: CrmActivity[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">Nothing recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {activity.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span className="bg-primary/60 mt-1.5 size-2 shrink-0 rounded-full" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium capitalize">{entry.action.replace(/_/g, ' ')}</span>
                    {entry.fromValue && entry.toValue && (
                      <span className="text-muted-foreground">
                        {' '}
                        {entry.fromValue.replace(/_/g, ' ')} → {entry.toValue.replace(/_/g, ' ')}
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {entry.actorName ?? 'System'} · {formatDateTime(entry.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

/* ── conversion ─────────────────────────────────────────────────────────── */

function ConvertCard({ lead, plans }: { lead: CrmLead; plans: SubscriptionPlan[] }) {
  const boundAction = useMemo(() => convertLeadAction.bind(null, lead.id), [lead.id])
  const [state, action, pending] = useActionState<ActionResult<null> | null, FormData>(
    boundAction,
    null,
  )

  if (lead.convertedBusinessId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Converted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            This lead is now a client. Plan, invoices and AR content are managed from the business
            record.
          </p>
          <Button asChild size="sm" className="w-full">
            <Link href={`/admin/businesses/${lead.convertedBusinessId}`}>
              <Building2 className="size-4" aria-hidden />
              Open business
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Convert to client</CardTitle>
        <CardDescription>
          One step creates the business, the owner’s login, the subscription and an opening invoice.
          Nothing is charged automatically — the invoice is raised for you to collect.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}

          <Field label="Owner name" htmlFor="ownerName" required>
            <Input id="ownerName" name="ownerName" defaultValue={lead.name} required />
          </Field>

          <Field label="Owner email" htmlFor="ownerEmail" required hint="This becomes their login.">
            <Input
              id="ownerEmail"
              name="ownerEmail"
              type="email"
              defaultValue={lead.email ?? ''}
              required
            />
          </Field>

          <Field
            label="Temporary password"
            htmlFor="ownerPassword"
            required
            hint="At least 10 characters. Share it with the owner and ask them to change it."
          >
            <Input
              id="ownerPassword"
              name="ownerPassword"
              type="password"
              minLength={10}
              autoComplete="new-password"
              required
            />
          </Field>

          <Field label="Business type" htmlFor="category" required>
            <Select id="category" name="category" defaultValue="restaurant" required>
              {BUSINESS_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {BUSINESS_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Plan" htmlFor="planId" required>
            <Select id="planId" name="planId" required defaultValue={lead.interestedPlanId ?? ''}>
              <option value="" disabled>
                Choose a plan
              </option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {formatMoney({ amount: plan.priceMinor, currency: plan.currency })}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Negotiated price (₹)"
            htmlFor="negotiatedPrice"
            hint="Optional. Overrides the plan price for this client only — the plan itself is untouched."
          >
            <Input id="negotiatedPrice" name="negotiatedPrice" type="number" min="0" step="0.01" />
          </Field>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="includeSetupFee"
              defaultChecked
              className="border-input accent-primary mt-0.5 size-4 rounded border"
            />
            <span>
              Add the plan’s setup fee to the opening invoice
              <span className="text-muted-foreground block text-xs">
                Skip it when you have waived the one-time AR setup charge.
              </span>
            </span>
          </label>

          <Button type="submit" className="w-full" disabled={pending || plans.length === 0}>
            {pending ? 'Converting…' : 'Convert to client'}
          </Button>

          {plans.length === 0 && (
            <Alert variant="warning">Create a plan first — a client cannot exist without one.</Alert>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

/* ── delete ─────────────────────────────────────────────────────────────── */

function DangerCard({ leadId, businessName }: { leadId: string; businessName: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base">Delete lead</CardTitle>
        <CardDescription>
          Removes it from the pipeline. Notes, tasks and activity go with it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Delete the lead for ${businessName}? This cannot be undone.`)) return
            startTransition(() => {
              void deleteLeadAction(leadId)
            })
          }}
        >
          <Trash2 className="size-4" aria-hidden />
          {pending ? 'Deleting…' : 'Delete lead'}
        </Button>
      </CardContent>
    </Card>
  )
}
