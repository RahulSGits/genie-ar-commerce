import { developerOverviewAction } from '@/lib/actions/developer'
import DeveloperConsole from '@/components/dashboard/DeveloperConsole'

export const metadata = { title: 'API & Webhooks' }
export const dynamic = 'force-dynamic'

export default async function DevelopersPage() {
  const overview = await developerOverviewAction()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">API &amp; Webhooks</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Read and write your catalogue programmatically, and get notified when things change.
          Built for agencies and for anyone syncing GENIE with an existing store.
        </p>
      </header>

      <DeveloperConsole {...overview} />
    </div>
  )
}
