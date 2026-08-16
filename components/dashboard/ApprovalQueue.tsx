'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button, Card } from '@/components/ui'
import { decideApprovalAction } from '@/lib/actions/workflow'

export default function ApprovalQueue({
  items,
  canDecide,
}: {
  items: { id: string; name: string; slug: string; updatedAt: string }[]
  canDecide: boolean
}) {
  const [pending, startTransition] = useTransition()

  const decide = (id: string, decision: 'approved' | 'rejected') => {
    startTransition(async () => {
      const result = await decideApprovalAction(id, decision)
      toast[result.ok ? 'success' : 'error'](
        result.ok ? (decision === 'approved' ? 'Published.' : 'Sent back to the editor.') : result.error,
      )
    })
  }

  return (
    <Card className="divide-y p-0">
      {items.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <Link href={`/dashboard/products/${item.id}`} className="font-medium hover:underline">
              {item.name}
            </Link>
            <p className="text-muted-foreground text-xs">
              Submitted {new Date(item.updatedAt).toLocaleString()}
            </p>
          </div>
          {canDecide ? (
            <div className="flex gap-2">
              <Button size="sm" disabled={pending} onClick={() => decide(item.id, 'approved')}>
                Approve &amp; publish
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => decide(item.id, 'rejected')}
              >
                Send back
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">Waiting on a manager</p>
          )}
        </div>
      ))}
    </Card>
  )
}
