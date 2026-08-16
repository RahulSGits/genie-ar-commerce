import {
  BarChart3, Boxes, Building2, CheckSquare, CreditCard, Layers, LayoutDashboard,
  LifeBuoy, Megaphone, Palette, Plug, QrCode, Settings, ShoppingBag, Sparkles,
  Terminal, Upload, Users,
} from 'lucide-react'
import Shell, { type NavSection, type NavItem } from '@/components/dashboard/Shell'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { getBranding } from '@/lib/db/repositories/platform'
import { getOutstandingCount } from '@/lib/db/repositories/billing'
import { getTerminology } from '@/config/terminology'
import { can } from '@/lib/auth/permissions'
import { getDb, type Row, num } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)
  const branding = getBranding()
  const terminology = getTerminology(business?.category)
  const outstanding = getOutstandingCount(ctx.businessId)

  const pendingApprovals = ctx.requiresApproval
    ? num(
        (getDb()
          .prepare(
            `SELECT COUNT(*) AS c FROM products
              WHERE business_id = ? AND approval_status = 'pending' AND deleted_at IS NULL`,
          )
          .get(ctx.businessId) as Row) ?? {},
        'c',
      )
    : 0

  /**
   * The sidebar mirrors the permission matrix rather than showing everything.
   *
   * This is convenience, not security — every one of these routes calls
   * `requirePermission` itself, because a hidden link is not an access control
   * and the URL is typeable.
   */
  const workspace: NavItem[] = [
    { href: '/dashboard', label: 'Overview', icon: <LayoutDashboard /> },
    { href: '/dashboard/create', label: 'Create', icon: <Sparkles /> },
    { href: '/dashboard/products', label: terminology.itemPlural, icon: <ShoppingBag /> },
    { href: '/dashboard/collections', label: 'Collections', icon: <Layers /> },
    { href: '/dashboard/campaigns', label: 'Campaigns', icon: <Megaphone /> },
    { href: '/dashboard/models', label: '3D Models', icon: <Boxes /> },
    { href: '/dashboard/qr', label: 'QR Codes', icon: <QrCode /> },
    { href: '/dashboard/analytics', label: 'Analytics', icon: <BarChart3 /> },
  ]

  if (ctx.requiresApproval) {
    workspace.push({
      href: '/dashboard/approvals',
      label: 'Approvals',
      icon: <CheckSquare />,
      badge: pendingApprovals,
    })
  }

  const account: NavItem[] = []
  if (can(ctx.role, 'products:write')) {
    account.push({ href: '/dashboard/import', label: 'Import', icon: <Upload /> })
  }
  if (can(ctx.role, 'business:write')) {
    account.push({ href: '/dashboard/business', label: 'Business Profile', icon: <Building2 /> })
  }
  if (can(ctx.role, 'brand:write')) {
    account.push({ href: '/dashboard/brand', label: 'Brand', icon: <Palette /> })
  }
  if (can(ctx.role, 'team:read')) {
    account.push({ href: '/dashboard/team', label: 'Team', icon: <Users /> })
  }
  if (can(ctx.role, 'api:manage')) {
    account.push(
      { href: '/dashboard/developers', label: 'API & Webhooks', icon: <Terminal /> },
      { href: '/dashboard/integrations', label: 'Integrations', icon: <Plug /> },
    )
  }
  if (can(ctx.role, 'billing:read')) {
    account.push({
      href: '/dashboard/billing',
      label: 'Billing',
      icon: <CreditCard />,
      badge: outstanding,
    })
  }
  account.push(
    { href: '/dashboard/settings', label: 'Settings', icon: <Settings /> },
    { href: '/dashboard/support', label: 'Help', icon: <LifeBuoy /> },
  )

  const sections: NavSection[] = [
    { items: workspace },
    { title: 'Account', items: account },
  ]

  return (
    <Shell
      sections={sections}
      brandLabel={business?.name ?? 'Dashboard'}
      brandSublabel={branding.name}
      brandEmoji={branding.faviconEmoji}
      homeHref="/dashboard"
      userEmail={ctx.user.email}
      searchAction="/dashboard/search"
    >
      {children}
    </Shell>
  )
}
