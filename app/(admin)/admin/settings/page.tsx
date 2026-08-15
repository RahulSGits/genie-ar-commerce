import { requireSuperAdmin } from '@/lib/auth/guards'
import {
  getBillingSettings, getFeatureFlags, getTaxSettings,
} from '@/lib/db/repositories/platform'
import SettingsPanel from '@/components/admin/SettingsPanel'

export const metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  await requireSuperAdmin()

  const flags = getFeatureFlags()
  const tax = getTaxSettings()
  const billing = getBillingSettings()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Platform-wide switches, tax and billing defaults.
        </p>
      </header>

      <SettingsPanel flags={flags} tax={tax} billing={billing} />
    </div>
  )
}
