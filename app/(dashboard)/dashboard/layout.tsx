import {
  BarChart3, Boxes, Building2, CreditCard, LayoutDashboard,
  LifeBuoy, QrCode, Settings, ShoppingBag, Sparkles,
} from 'lucide-react'
import Shell, { type NavSection } from '@/components/dashboard/Shell'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import { getBranding } from '@/lib/db/repositories/platform'
import { getOutstandingCount } from '@/lib/db/repositories/billing'
import { getTerminology } from '@/config/terminology'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)
  const branding = getBranding()
  const terminology = getTerminology(business?.category)
  const outstanding = getOutstandingCount(ctx.businessId)

  const sections: NavSection[] = [
    {
      items: [
        { href: '/dashboard', label: 'Overview', icon: <LayoutDashboard /> },
        { href: '/dashboard/create', label: 'Create', icon: <Sparkles /> },
        { href: '/dashboard/products', label: terminology.itemPlural, icon: <ShoppingBag /> },
        { href: '/dashboard/models', label: '3D Models', icon: <Boxes /> },
        { href: '/dashboard/qr', label: 'QR Codes', icon: <QrCode /> },
        { href: '/dashboard/analytics', label: 'Analytics', icon: <BarChart3 /> },
      ],
    },
    {
      title: 'Account',
      items: [
        { href: '/dashboard/business', label: 'Business Profile', icon: <Building2 /> },
        { href: '/dashboard/billing', label: 'Billing', icon: <CreditCard />, badge: outstanding },
        { href: '/dashboard/settings', label: 'Settings', icon: <Settings /> },
        { href: '/dashboard/support', label: 'Help', icon: <LifeBuoy /> },
      ],
    },
  ]

  return (
    <Shell
      sections={sections}
      brandLabel={business?.name ?? 'Dashboard'}
      brandSublabel={branding.name}
      brandEmoji={branding.faviconEmoji}
      homeHref="/dashboard"
      userEmail={ctx.user.email}
    >
      {children}
    </Shell>
  )
}
