import { requireSuperAdmin } from '@/lib/auth/guards'
import { getBranding, listCmsSections } from '@/lib/db/repositories/platform'
import CmsEditor from '@/components/admin/CmsEditor'

export const metadata = { title: 'Content' }
export const dynamic = 'force-dynamic'

export default async function ContentPage() {
  await requireSuperAdmin()

  const sections = listCmsSections()
  const branding = getBranding()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Content</h1>
        <p className="text-muted-foreground text-sm">
          The public site reads everything here at request time — no deploy needed.
        </p>
      </header>

      <CmsEditor sections={sections} branding={branding} />
    </div>
  )
}
