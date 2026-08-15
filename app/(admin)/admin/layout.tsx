import {
  BadgePercent, Building2, FileText, LayoutDashboard, LifeBuoy,
  Newspaper, ScrollText, Settings, Tags, Users,
} from 'lucide-react'
import Shell, { type NavSection } from '@/components/dashboard/Shell'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { getBranding } from '@/lib/db/repositories/platform'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The guard is the authorization for every page below — not the URL prefix.
  const admin = await requireSuperAdmin()
  const branding = getBranding()

  const sections: NavSection[] = [
    {
      items: [
        { href: '/admin', label: 'Dashboard', icon: <LayoutDashboard /> },
        { href: '/admin/businesses', label: 'Businesses', icon: <Building2 /> },
      ],
    },
    {
      title: 'Revenue',
      items: [
        { href: '/admin/invoices', label: 'Invoices', icon: <FileText /> },
        { href: '/admin/pricing', label: 'Pricing', icon: <Tags /> },
        { href: '/admin/offers', label: 'Offers', icon: <BadgePercent /> },
      ],
    },
    {
      title: 'Growth',
      items: [
        { href: '/admin/crm', label: 'CRM', icon: <Users /> },
        { href: '/admin/content', label: 'Content', icon: <Newspaper /> },
        { href: '/admin/support', label: 'Support', icon: <LifeBuoy /> },
      ],
    },
    {
      title: 'Platform',
      items: [
        { href: '/admin/settings', label: 'Settings', icon: <Settings /> },
        { href: '/admin/audit', label: 'Audit', icon: <ScrollText /> },
      ],
    },
  ]

  return (
    <Shell
      sections={sections}
      brandLabel={branding.name}
      brandSublabel="Platform admin"
      brandEmoji={branding.faviconEmoji}
      homeHref="/admin"
      userEmail={admin.email}
    >
      {children}
    </Shell>
  )
}
