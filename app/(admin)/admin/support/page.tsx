import Link from 'next/link'
import { LifeBuoy } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { getTicketMessages, listTickets } from '@/lib/db/repositories/crm'
import { adminReplyTicketAction, closeTicketAction } from '@/lib/actions/admin'
import type { TicketMessage } from '@/types/domain'
import { formatDateTime } from '@/lib/utils'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle,
  EmptyState, Textarea,
} from '@/components/ui'

export const metadata = { title: 'Support' }
export const dynamic = 'force-dynamic'

const STATUSES = ['all', 'open', 'pending', 'closed'] as const

async function replyToTicket(ticketId: string, formData: FormData) {
  'use server'
  await adminReplyTicketAction(ticketId, String(formData.get('body') ?? ''))
}

async function closeTicket(ticketId: string) {
  'use server'
  await closeTicketAction(ticketId)
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireSuperAdmin()
  const { status } = await searchParams
  const active = STATUSES.includes(status as (typeof STATUSES)[number]) ? status! : 'all'

  const tickets = listTickets({ status: active })

  // Threads are read here rather than per card: a Server Component cannot fetch
  // on expand, and a ticket list without its replies is not answerable.
  const threads: Record<string, TicketMessage[]> = {}
  for (const ticket of tickets) threads[ticket.id] = getTicketMessages(ticket.id)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Support</h1>
        <p className="text-muted-foreground text-sm">
          Tickets raised from client dashboards. Replying moves a ticket to pending.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((option) => (
          <Button
            key={option}
            asChild
            size="sm"
            variant={active === option ? 'secondary' : 'outline'}
          >
            <Link href={option === 'all' ? '/admin/support' : `/admin/support?status=${option}`}>
              <span className="capitalize">{option}</span>
            </Link>
          </Button>
        ))}
      </div>

      {tickets.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy />}
          title="No tickets"
          description={
            active === 'all'
              ? 'Nothing has been raised yet. Clients open tickets from their dashboard.'
              : `No ${active} tickets right now.`
          }
        />
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => {
            const messages = threads[ticket.id] ?? []
            return (
              <Card key={ticket.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{ticket.subject}</CardTitle>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {ticket.businessName ?? 'Unknown business'} · {ticket.category} ·{' '}
                        {formatDateTime(ticket.updatedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {ticket.priority === 'high' && <Badge variant="destructive">High</Badge>}
                      <Badge
                        variant={
                          ticket.status === 'open'
                            ? 'warning'
                            : ticket.status === 'closed'
                              ? 'muted'
                              : 'default'
                        }
                        className="capitalize"
                      >
                        {ticket.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      {messages.length} {messages.length === 1 ? 'message' : 'messages'}
                    </summary>

                    <div className="mt-3 space-y-3">
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={
                            message.isStaff
                              ? 'bg-primary/5 border-primary/20 rounded-lg border p-3'
                              : 'bg-muted/40 rounded-lg border p-3'
                          }
                        >
                          <p className="text-sm whitespace-pre-wrap">{message.body}</p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {message.isStaff ? 'You' : (message.authorName ?? 'Client')} ·{' '}
                            {formatDateTime(message.createdAt)}
                          </p>
                        </div>
                      ))}

                      <form action={replyToTicket.bind(null, ticket.id)} className="space-y-2">
                        <Textarea
                          name="body"
                          required
                          aria-label={`Reply to ${ticket.subject}`}
                          placeholder="Write a reply…"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button type="submit" size="sm">
                            Send reply
                          </Button>
                        </div>
                      </form>

                      {ticket.status !== 'closed' && (
                        <form action={closeTicket.bind(null, ticket.id)}>
                          <Button type="submit" size="sm" variant="outline">
                            Close ticket
                          </Button>
                        </form>
                      )}
                    </div>
                  </details>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
