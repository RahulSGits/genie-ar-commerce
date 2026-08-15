import { Megaphone } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { listPromotions } from '@/lib/db/repositories/platform'
import { formatDate } from '@/lib/utils'
import {
  Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState,
  TBody, TD, TH, THead, TR, Table,
} from '@/components/ui'
import OfferEditor, { CouponForm } from '@/components/admin/OfferEditor'

export const metadata = { title: 'Offers' }
export const dynamic = 'force-dynamic'

export default async function AdminOffersPage() {
  await requireSuperAdmin()

  const promotions = listPromotions()
  const now = Date.now()

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Offers</h1>
        <p className="text-muted-foreground text-sm">
          Campaigns that run on the landing page, and the coupon codes behind them.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Promotions</h2>
          <p className="text-muted-foreground text-sm">
            An active campaign inside its window shows a banner site-wide on the landing page.
          </p>
        </div>

        <Card>
          <CardContent className="pt-5">
            {promotions.length === 0 ? (
              <EmptyState
                icon={<Megaphone />}
                title="No campaigns yet"
                description="Create one below to put a banner on the landing page for a fixed window."
                className="border-0"
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Campaign</TH>
                    <TH>Discount</TH>
                    <TH>Code</TH>
                    <TH>Window</TH>
                    <TH>Banner</TH>
                    <TH>State</TH>
                  </TR>
                </THead>
                <TBody>
                  {promotions.map((promo) => {
                    const live =
                      promo.isActive &&
                      new Date(promo.startsAt).getTime() <= now &&
                      new Date(promo.endsAt).getTime() >= now

                    return (
                      <TR key={promo.id}>
                        <TD className="font-medium">{promo.name}</TD>
                        <TD className="tabular-nums">
                          {promo.discountType === 'percentage'
                            ? `${promo.discountValue}%`
                            : `₹${promo.discountValue}`}
                        </TD>
                        <TD className="font-mono text-xs">{promo.couponCode ?? '—'}</TD>
                        <TD className="text-muted-foreground whitespace-nowrap">
                          {formatDate(promo.startsAt)} – {formatDate(promo.endsAt)}
                        </TD>
                        <TD>
                          {promo.showBanner ? (
                            <Badge variant="secondary">On</Badge>
                          ) : (
                            <Badge variant="muted">Off</Badge>
                          )}
                        </TD>
                        <TD>
                          {live ? (
                            <Badge variant="success">Live</Badge>
                          ) : promo.isActive ? (
                            <Badge variant="warning">Scheduled</Badge>
                          ) : (
                            <Badge variant="muted">Inactive</Badge>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign editor</CardTitle>
            <CardDescription>
              Pick an existing campaign to edit it, or leave it on “New campaign” to create one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OfferEditor promotions={promotions} />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Coupons</h2>
          <p className="text-muted-foreground text-sm">
            Codes are keyed by the code itself — saving a code that already exists updates that
            coupon rather than creating a second one.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create or update a coupon</CardTitle>
          </CardHeader>
          <CardContent>
            <CouponForm />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
