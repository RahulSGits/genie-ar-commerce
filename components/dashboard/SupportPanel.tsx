'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { MessageSquare } from 'lucide-react'
import {
  Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  EmptyState, Field, Input, Select, Textarea,
} from '@/components/ui'
import { createTicketAction, replyTicketAction } from '@/lib/actions/dashboard'
import { formatDateTime } from '@/lib/utils'
import type { ActionResult } from '@/lib/auth/errors'
import type { SupportTicket, TicketMessage } from '@/types/domain'
import type { BadgeProps } from '@/components/ui'

type BadgeVariant = NonNullable<BadgeProps['variant']>

const STATUS_VARIANTS: Record<SupportTicket['status'], BadgeVariant> = {
  open: 'default',
  pending: 'warning',
  closed: 'muted',
}

const PRIORITY_VARIANTS: Record<SupportTicket['priority'], BadgeVariant> = {
  low: 'muted',
  normal: 'secondary',
  high: 'destructive',
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  )
}

function ReplyForm({ ticketId }: { ticketId: string }) {
  return (
    <form
      action={async (formData) => {
        const body = String(formData.get('body') ?? '').trim()
        if (!body) return
        await replyTicketAction(ticketId, body)
      }}
      className="space-y-2"
    >
      <Textarea
        name="body"
        rows={3}
        required
        placeholder="Add to this conversation…"
        aria-label="Your reply"
      />
      <div className="flex justify-end">
        <SubmitButton label="Send reply" pendingLabel="Sending…" />
      </div>
    </form>
  )
}

export default function SupportPanel({
  tickets,
  messages,
  timezone,
}: {
  tickets: SupportTicket[]
  /** Keyed by ticket id — resolved on the server so the list renders in one pass. */
  messages: Record<string, TicketMessage[]>
  timezone: string
}) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    createTicketAction,
    null,
  )

  return (
    <div className="grid gap-4 lg:grid-cols-5 lg:items-start">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Open a ticket</CardTitle>
          <CardDescription>
            Tell us what happened and what you expected. We reply here and by email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            {state?.ok && <Alert variant="success">Ticket created. We will be in touch.</Alert>}
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}

            <Field label="Subject" htmlFor="subject" required>
              <Input
                id="subject"
                name="subject"
                required
                minLength={3}
                maxLength={160}
                placeholder="AR button does nothing on iPhone"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="category" required>
                <Select id="category" name="category" defaultValue="technical" required>
                  <option value="technical">Technical</option>
                  <option value="billing">Billing</option>
                  <option value="feature">Feature request</option>
                  <option value="other">Other</option>
                </Select>
              </Field>

              <Field label="Priority" htmlFor="priority" required>
                <Select id="priority" name="priority" defaultValue="normal" required>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High — blocking</option>
                </Select>
              </Field>
            </div>

            <Field
              label="Details"
              htmlFor="body"
              required
              hint="Which product, which device, and what you saw."
            >
              <Textarea id="body" name="body" rows={6} required minLength={10} />
            </Field>

            <div className="flex justify-end">
              <SubmitButton label="Submit ticket" pendingLabel="Submitting…" />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Your tickets</CardTitle>
          <CardDescription>Newest first. Open one to read the full thread.</CardDescription>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <EmptyState
              icon={<MessageSquare />}
              title="No tickets yet"
              description="Anything you raise appears here with our replies."
              className="border-0"
            />
          ) : (
            <ul className="space-y-3">
              {tickets.map((ticket) => {
                const thread = messages[ticket.id] ?? []
                return (
                  <li key={ticket.id} className="rounded-xl border">
                    <details className="group">
                      <summary className="hover:bg-muted/40 flex cursor-pointer flex-wrap items-center gap-2 rounded-xl px-4 py-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {ticket.subject}
                        </span>
                        <Badge variant={PRIORITY_VARIANTS[ticket.priority]} className="capitalize">
                          {ticket.priority}
                        </Badge>
                        <Badge variant={STATUS_VARIANTS[ticket.status]} className="capitalize">
                          {ticket.status}
                        </Badge>
                      </summary>

                      <div className="space-y-4 border-t px-4 py-4">
                        <p className="text-muted-foreground text-xs">
                          <span className="capitalize">{ticket.category}</span> · opened{' '}
                          {formatDateTime(ticket.createdAt, timezone)}
                        </p>

                        <ul className="space-y-3">
                          {thread.map((message) => (
                            <li
                              key={message.id}
                              className={
                                message.isStaff
                                  ? 'bg-primary/5 border-primary/20 rounded-lg border px-3 py-2'
                                  : 'bg-muted/40 rounded-lg px-3 py-2'
                              }
                            >
                              <div className="mb-1 flex flex-wrap items-baseline gap-2">
                                <span className="text-sm font-medium">
                                  {message.isStaff ? 'Support' : (message.authorName ?? 'You')}
                                </span>
                                <span className="text-muted-foreground text-xs">
                                  {formatDateTime(message.createdAt, timezone)}
                                </span>
                              </div>
                              <p className="text-sm whitespace-pre-wrap">{message.body}</p>
                            </li>
                          ))}
                        </ul>

                        {ticket.status === 'closed' ? (
                          <p className="text-muted-foreground text-sm">
                            This ticket is closed. Open a new one if it comes back.
                          </p>
                        ) : (
                          <ReplyForm ticketId={ticket.id} />
                        )}
                      </div>
                    </details>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
