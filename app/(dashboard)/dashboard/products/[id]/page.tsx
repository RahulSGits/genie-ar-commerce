import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download, ExternalLink } from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { getModel, getProduct, listCategories, listModels } from '@/lib/db/repositories/catalog'
import { deleteProductAction, updateProductAction } from '@/lib/actions/dashboard'
import { getTerminology } from '@/config/terminology'
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import ModelViewer from '@/components/ar/ModelViewer'
import ProductForm from '@/components/dashboard/ProductForm'

export const metadata = { title: 'Edit product' }
export const dynamic = 'force-dynamic'

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const terminology = getTerminology(business.category)

  const product = getProduct(ctx.businessId, id)
  if (!product) notFound()

  const model = product.modelId ? getModel(ctx.businessId, product.modelId) : null
  const categories = listCategories(ctx.businessId)
  const models = listModels(ctx.businessId).filter((m) => m.status === 'ready')

  const publicUrl = `/ar/${ctx.businessSlug}/${product.slug}`

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/dashboard/products"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {terminology.itemPlural}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
          <Badge
            variant={
              product.status === 'published'
                ? 'success'
                : product.status === 'draft'
                  ? 'warning'
                  : 'muted'
            }
            className="capitalize"
          >
            {product.status}
          </Badge>
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link href={`/dashboard/products/${product.id}/downloads`}>
              <Download className="size-3.5" aria-hidden />
              Downloads
            </Link>
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          {product.status === 'published' ? (
            <Link
              href={publicUrl}
              target="_blank"
              className="hover:text-foreground inline-flex items-center gap-1.5"
            >
              {publicUrl}
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          ) : (
            <>
              Will be live at <span className="font-mono text-xs">{publicUrl}</span> once published.
            </>
          )}
        </p>
      </header>

      {model && model.status === 'ready' && model.glbUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {/* The real renderer, not a screenshot — what loads slowly or lands at
                the wrong scale here will do the same on a customer's phone. */}
            <ModelViewer
              src={model.glbUrl}
              iosSrc={model.usdzUrl}
              poster={model.posterUrl}
              alt={`3D preview of ${product.name}`}
              placement={product.placement}
              enableAr={product.arEnabled}
              className="bg-muted/40 aspect-square w-full rounded-lg sm:aspect-video"
            />
          </CardContent>
        </Card>
      ) : model ? (
        <Alert variant="warning">
          The attached model “{model.name}” is {model.status}. AR stays off until it is ready.
        </Alert>
      ) : null}

      <ProductForm
        action={updateProductAction.bind(null, product.id)}
        submitLabel="Save changes"
        product={product}
        categories={categories}
        models={models}
        currency={business.currency}
        showFoodFields={terminology.showFoodFields}
        defaultPlacement={terminology.defaultPlacement}
        defaultCtaLabel={terminology.defaultCtaLabel}
        deleteAction={deleteProductAction.bind(null, product.id)}
      />
    </div>
  )
}
