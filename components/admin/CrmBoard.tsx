'use client'

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarClock, GripVertical, Mail, Phone, Plus, Users } from 'lucide-react'
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle,
  EmptyState, Field, Input, Select,
} from '@/components/ui'
import { createLeadAction, moveLeadStageAction } from '@/lib/actions/admin'
import { CRM_STAGES, CRM_STAGE_LABELS, type CrmLead, type CrmStage } from '@/types/domain'
import type { ActionResult } from '@/lib/auth/errors'
import { formatMoney } from '@/utils/money'
import { cn, daysUntil, formatDate } from '@/lib/utils'

const isStage = (value: string): value is CrmStage =>
  (CRM_STAGES as readonly string[]).includes(value)

/**
 * A drag target is either a column (id is the stage) or another card (the stage
 * rides along in its drag data), so both cases are resolved through one helper.
 */
function resolveStage(id: UniqueIdentifier, data: Record<string, unknown> | undefined): CrmStage | null {
  const carried = data?.stage
  if (typeof carried === 'string' && isStage(carried)) return carried
  const raw = String(id)
  return isStage(raw) ? raw : null
}

export default function CrmBoard({ leads }: { leads: CrmLead[] }) {
  /**
   * Stage overrides applied on drop, merged over server data on render. Keeping
   * the override map rather than a copy of the list means a revalidation that
   * brings back other edits is never thrown away by stale local state.
   */
  const [moved, setMoved] = useState<Record<string, CrmStage>>({})
  const [dragging, setDragging] = useState<CrmLead | null>(null)
  const [, startTransition] = useTransition()

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so tapping a card still opens it.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columns = useMemo(
    () =>
      CRM_STAGES.map((stage) => ({
        stage,
        leads: leads.filter((lead) => (moved[lead.id] ?? lead.stage) === stage),
      })),
    [leads, moved],
  )

  function handleDragStart(event: DragStartEvent) {
    setDragging(leads.find((lead) => lead.id === String(event.active.id)) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const leadId = String(active.id)
    const from = resolveStage(active.id, active.data.current)
    const to = resolveStage(over.id, over.data.current)
    if (!to || to === from) return

    setMoved((prev) => ({ ...prev, [leadId]: to }))
    startTransition(() => {
      void moveLeadStageAction(leadId, to)
    })
  }

  return (
    <div className="space-y-4">
      <AddLeadForm />

      {leads.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No leads yet"
          description="Add the first prospect and drag it across the pipeline as the conversation moves."
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div className="flex min-w-max items-start gap-3">
              {columns.map((column) => (
                <Column key={column.stage} stage={column.stage} leads={column.leads} />
              ))}
            </div>
          </div>

          <DragOverlay>{dragging && <CardBody lead={dragging} />}</DragOverlay>
        </DndContext>
      )}
    </div>
  )
}

/* ── column ─────────────────────────────────────────────────────────────── */

function Column({ stage, leads }: { stage: CrmStage; leads: CrmLead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { stage } })
  const total = leads.reduce((sum, lead) => sum + lead.expectedValueMinor, 0)

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'bg-muted/30 flex w-72 shrink-0 flex-col rounded-xl border p-2 transition-colors',
        isOver && 'border-primary bg-primary/5',
      )}
    >
      <header className="flex items-baseline justify-between gap-2 px-2 py-1.5">
        <h2 className="text-sm font-semibold">{CRM_STAGE_LABELS[stage]}</h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {leads.length} · {formatMoney({ amount: total, currency: 'INR' })}
        </span>
      </header>

      <SortableContext items={leads.map((lead) => lead.id)} strategy={verticalListSortingStrategy}>
        <div className="min-h-24 space-y-2">
          {leads.length === 0 ? (
            <p className="text-muted-foreground/60 px-2 py-8 text-center text-xs">Drop a lead here</p>
          ) : (
            leads.map((lead) => <LeadCard key={lead.id} lead={lead} stage={stage} />)
          )}
        </div>
      </SortableContext>
    </section>
  )
}

/* ── card ───────────────────────────────────────────────────────────────── */

function LeadCard({ lead, stage }: { lead: CrmLead; stage: CrmStage }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: lead.id, data: { stage } })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('bg-card rounded-lg border shadow-sm', isDragging && 'opacity-40')}
    >
      <div className="flex items-start gap-1 p-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Move ${lead.businessName}`}
          className="text-muted-foreground/50 hover:text-foreground hover:bg-accent touch-none rounded-md p-1.5"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <Link href={`/admin/crm/${lead.id}`} className="min-w-0 flex-1 rounded-md py-0.5">
          <CardSummary lead={lead} />
        </Link>
      </div>
    </div>
  )
}

/** Used both in the board and inside the drag overlay. */
function CardBody({ lead }: { lead: CrmLead }) {
  return (
    <div className="bg-card w-72 rounded-lg border p-2 shadow-lg">
      <div className="flex items-start gap-1">
        <span className="text-muted-foreground/50 p-1.5">
          <GripVertical className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 py-0.5">
          <CardSummary lead={lead} />
        </div>
      </div>
    </div>
  )
}

function CardSummary({ lead }: { lead: CrmLead }) {
  const overdue = lead.nextFollowUpAt ? daysUntil(lead.nextFollowUpAt) < 0 : false

  return (
    <div className="min-w-0 space-y-1.5">
      <p className="truncate text-sm font-medium">{lead.businessName}</p>
      <p className="text-muted-foreground truncate text-xs">
        {lead.name}
        {lead.city && ` · ${lead.city}`}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {lead.expectedValueMinor > 0 && (
          <Badge variant="secondary" className="tabular-nums">
            {formatMoney({ amount: lead.expectedValueMinor, currency: 'INR' })}
          </Badge>
        )}
        {lead.nextFollowUpAt && (
          <Badge variant={overdue ? 'destructive' : 'muted'}>
            <CalendarClock className="size-3" aria-hidden />
            {formatDate(lead.nextFollowUpAt)}
          </Badge>
        )}
      </div>

      {(lead.phone || lead.email) && (
        <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
          {lead.phone ? <Phone className="size-3 shrink-0" aria-hidden /> : <Mail className="size-3 shrink-0" aria-hidden />}
          <span className="truncate">{lead.phone ?? lead.email}</span>
        </p>
      )}
    </div>
  )
}

/* ── add lead ───────────────────────────────────────────────────────────── */

function AddLeadForm() {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<ActionResult<null> | null, FormData>(
    createLeadAction,
    null,
  )

  useEffect(() => {
    if (state?.ok) setOpen(false)
  }, [state])

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Add lead
      </Button>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New lead</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Contact name" htmlFor="lead-name" required>
              <Input id="lead-name" name="name" required autoFocus />
            </Field>

            <Field label="Business name" htmlFor="lead-business" required>
              <Input id="lead-business" name="businessName" required />
            </Field>

            <Field label="Business type" htmlFor="lead-type" hint="Free text, e.g. rooftop cafe.">
              <Input id="lead-type" name="businessType" />
            </Field>

            <Field label="Phone" htmlFor="lead-phone">
              <Input id="lead-phone" name="phone" type="tel" inputMode="tel" />
            </Field>

            <Field label="Email" htmlFor="lead-email">
              <Input id="lead-email" name="email" type="email" />
            </Field>

            <Field label="City" htmlFor="lead-city">
              <Input id="lead-city" name="city" />
            </Field>

            <Field label="Source" htmlFor="lead-source" hint="Where the lead came from.">
              <Input id="lead-source" name="source" placeholder="Referral, walk-in, Instagram" />
            </Field>

            <Field label="Stage" htmlFor="lead-stage">
              <Select id="lead-stage" name="stage" defaultValue="new">
                {CRM_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {CRM_STAGE_LABELS[stage]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Expected value (₹)" htmlFor="lead-value" hint="Deal size you expect to close.">
              <Input id="lead-value" name="expectedValue" type="number" min="0" step="0.01" defaultValue="0" />
            </Field>

            <Field label="Next follow-up" htmlFor="lead-followup">
              <Input id="lead-followup" name="nextFollowUpAt" type="date" />
            </Field>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding…' : 'Add lead'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
