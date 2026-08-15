import Link from 'next/link'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { getTicketMessages, listTickets } from '@/lib/db/repositories/crm'
import { getBranding } from '@/lib/db/repositories/platform'
import { Alert } from '@/components/ui'
import SupportPanel from '@/components/dashboard/SupportPanel'
import type { TicketMessage } from '@/types/domain'

export const metadata = { title: 'Help' }
export const dynamic = 'force-dynamic'

export default async function SupportPage() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const branding = getBranding()
  const tickets = listTickets({ businessId: ctx.businessId })

  // Threads are resolved here rather than per-ticket in the client, so opening a
  // ticket is a disclosure toggle instead of a round trip.
  const messages: Record<string, TicketMessage[]> = Object.fromEntries(
    tickets.map((ticket) => [ticket.id, getTicketMessages(ticket.id)]),
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Help</h1>
        <p className="text-muted-foreground text-sm">
          Raise an issue, track what we said, and reply in the same thread.
        </p>
      </header>

      <Alert>
        Something urgent, or a billing question you would rather not put in a ticket? Email{' '}
        <Link
          href={`mailto:${branding.supportEmail}`}
          className="text-primary font-medium hover:underline"
        >
          {branding.supportEmail}
        </Link>
        .
      </Alert>

      <SupportPanel tickets={tickets} messages={messages} timezone={business.timezone} />
    </div>
  )
}
