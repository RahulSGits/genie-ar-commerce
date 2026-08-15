import Link from 'next/link'
import { ScrollText } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { listAuditLogs } from '@/lib/db/repositories/platform'
import { formatDateTime } from '@/lib/utils'
import { Badge, Button, Card, CardContent, EmptyState, Table, TBody, TD, TH, THead, TR } from '@/components/ui'

export const metadata = { title: 'Audit log' }
export const dynamic = 'force-dynamic'

const LIMIT = 200

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string }>
}) {
  await requireSuperAdmin()
  const { entityType } = await searchParams

  const all = listAuditLogs({ limit: LIMIT })
  const rows = entityType ? listAuditLogs({ limit: LIMIT, entityType }) : all

  // Filter options come from the unfiltered read, so a filter never hides its siblings.
  const entityTypes = [...new Set(all.map((log) => log.entityType))].sort()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          Every privileged action — price changes, suspensions, deletions. Last {LIMIT} entries.
        </p>
      </header>

      {entityTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant={entityType ? 'outline' : 'secondary'}>
            <Link href="/admin/audit">All</Link>
          </Button>
          {entityTypes.map((type) => (
            <Button
              key={type}
              asChild
              size="sm"
              variant={entityType === type ? 'secondary' : 'outline'}
            >
              <Link href={`/admin/audit?entityType=${encodeURIComponent(type)}`}>{type}</Link>
            </Button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title="Nothing logged yet"
          description={
            entityType
              ? `No entries for ${entityType}. Clear the filter to see everything.`
              : 'Actions that change money, access or availability will appear here.'
          }
        />
      ) : (
        <Card>
          <CardContent className="pt-5">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Changes</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((log) => (
                  <TR key={log.id}>
                    <TD className="text-muted-foreground whitespace-nowrap text-xs">
                      {formatDateTime(log.createdAt)}
                    </TD>
                    <TD className="text-sm">{log.actorEmail ?? 'System'}</TD>
                    <TD>
                      <Badge variant="muted">{log.action}</Badge>
                    </TD>
                    <TD className="text-sm">
                      <span className="block">{log.entityType}</span>
                      {log.entityId && (
                        <span className="text-muted-foreground font-mono text-xs">
                          {log.entityId.slice(0, 8)}
                        </span>
                      )}
                    </TD>
                    <TD>
                      {log.beforeValue === null && log.afterValue === null ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <details className="max-w-xs">
                          <summary className="cursor-pointer text-xs font-medium">View</summary>
                          <div className="mt-1 space-y-1">
                            {log.beforeValue !== null && (
                              <pre className="bg-muted rounded-md p-2 text-[11px] break-all whitespace-pre-wrap">
                                before {JSON.stringify(log.beforeValue)}
                              </pre>
                            )}
                            {log.afterValue !== null && (
                              <pre className="bg-muted rounded-md p-2 text-[11px] break-all whitespace-pre-wrap">
                                after {JSON.stringify(log.afterValue)}
                              </pre>
                            )}
                          </div>
                        </details>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
