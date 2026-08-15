import Link from 'next/link'
import { Boxes, Trash2, Triangle } from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById, getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { listModels } from '@/lib/db/repositories/catalog'
import { deleteModelAction } from '@/lib/actions/dashboard'
import { usageBars } from '@/lib/billing/entitlements'
import { formatBytes, formatDate } from '@/lib/utils'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress,
} from '@/components/ui'
import ModelViewer from '@/components/ar/ModelViewer'
import ModelUploader from '@/components/dashboard/ModelUploader'
import type { ModelStatus } from '@/types/domain'

export const metadata = { title: '3D Models' }
export const dynamic = 'force-dynamic'

const STATUS_VARIANT: Record<ModelStatus, 'success' | 'warning' | 'destructive'> = {
  ready: 'success',
  processing: 'warning',
  failed: 'destructive',
}

export default async function ModelsPage() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const models = listModels(ctx.businessId)
  const bars = usageBars(getEntitlements(ctx.businessId), getUsage(ctx.businessId))
  const modelBar = bars.find((b) => b.label === 'AR models')
  const storageBar = bars.find((b) => b.label === 'storage')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">3D Models</h1>
        <p className="text-muted-foreground text-sm">
          The assets your customers see in AR. Attach one to a product to make it scannable.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ModelUploader />
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Plan usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {modelBar && (
              <div>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">AR models</span>
                  <span className="tabular-nums">
                    {modelBar.current} / {modelBar.limit === null ? '∞' : modelBar.limit}
                  </span>
                </div>
                <Progress
                  value={modelBar.percent}
                  indicatorClassName={modelBar.nearLimit ? 'bg-warning' : undefined}
                />
              </div>
            )}

            {storageBar && (
              <div>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Storage</span>
                  <span className="tabular-nums">
                    {formatBytes(storageBar.current)} /{' '}
                    {storageBar.limit === null ? '∞' : formatBytes(storageBar.limit)}
                  </span>
                </div>
                <Progress
                  value={storageBar.percent}
                  indicatorClassName={storageBar.nearLimit ? 'bg-warning' : undefined}
                />
              </div>
            )}

            <p className="text-muted-foreground text-xs">
              Deleting a model frees its storage but breaks AR on any product still pointing at it.
            </p>
          </CardContent>
        </Card>
      </div>

      {models.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="No 3D models yet"
          description="Upload a GLB above. Once it is ready you can attach it to a product and print a QR code for it."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/products">Go to products</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {models.map((model) => (
            <Card key={model.id} className="flex flex-col overflow-hidden">
              <div className="bg-muted/40 h-44 border-b">
                {model.glbUrl ? (
                  <ModelViewer
                    src={model.glbUrl}
                    poster={model.posterUrl}
                    alt={model.name}
                    enableAr={false}
                    autoRotate
                    className="size-full"
                  />
                ) : (
                  <div className="text-muted-foreground/50 grid size-full place-items-center">
                    <Boxes className="size-8" aria-hidden />
                  </div>
                )}
              </div>

              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="min-w-0 truncate text-base">{model.name}</CardTitle>
                  <Badge variant={STATUS_VARIANT[model.status]} className="capitalize">
                    {model.status}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-3 pt-0">
                <dl className="text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <div>
                    <dt className="sr-only">Format</dt>
                    <dd className="text-foreground font-medium uppercase">
                      {model.format ?? 'unknown'}
                    </dd>
                  </div>
                  <div className="text-right tabular-nums">
                    <dt className="sr-only">File size</dt>
                    <dd>{formatBytes(model.fileSizeBytes)}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <Triangle className="size-3" aria-hidden />
                    <dt className="sr-only">Triangles</dt>
                    <dd className="tabular-nums">
                      {model.triangleCount === null
                        ? 'Not measured'
                        : `${model.triangleCount.toLocaleString('en-IN')} tris`}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="sr-only">Uploaded</dt>
                    <dd>{formatDate(model.createdAt, business.timezone)}</dd>
                  </div>
                </dl>

                {model.status === 'failed' && model.errorMessage && (
                  <p className="text-destructive text-xs">{model.errorMessage}</p>
                )}

                <form action={deleteModelAction.bind(null, model.id)} className="mt-auto">
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive w-full"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Delete
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
