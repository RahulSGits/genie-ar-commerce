import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById, getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { listQrCodes, qrTargetUrl } from '@/lib/db/repositories/qr'
import { listProducts } from '@/lib/db/repositories/catalog'
import { usageBars } from '@/lib/billing/entitlements'
import { Badge } from '@/components/ui'
import QrManager, { type QrProductOption, type QrRow } from '@/components/dashboard/QrManager'

export const metadata = { title: 'QR Codes' }
export const dynamic = 'force-dynamic'

export default async function QrPage() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const codes = listQrCodes(ctx.businessId)
  const { rows: products } = listProducts(ctx.businessId, { limit: 500 })
  const qrBar = usageBars(getEntitlements(ctx.businessId), getUsage(ctx.businessId)).find(
    (b) => b.label === 'QR codes',
  )

  // Only the path is resolved here. The origin has to come from the browser, so
  // an operator on a LAN dev host prints a code their own phone can resolve.
  const rows: QrRow[] = codes.map((code) => ({ code, targetPath: qrTargetUrl(code.token, '') }))

  const productOptions: QrProductOption[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    priceMinor: p.priceMinor,
    currency: p.currency,
  }))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">QR Codes</h1>
          <p className="text-muted-foreground text-sm">
            Printed codes are the entry point to every AR session. Each one tracks its own scans.
          </p>
        </div>
        {qrBar && (
          <Badge variant={qrBar.nearLimit ? 'warning' : 'secondary'} className="tabular-nums">
            {qrBar.current} / {qrBar.limit === null ? '∞' : qrBar.limit} used
          </Badge>
        )}
      </header>

      <QrManager rows={rows} products={productOptions} timezone={business.timezone} />
    </div>
  )
}
