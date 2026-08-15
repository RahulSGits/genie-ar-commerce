import Link from 'next/link'
import { QrCode } from 'lucide-react'
import { Button } from '@/components/ui'

export const metadata = { title: 'Code not available' }

/**
 * Landing page for a QR that no longer resolves — unknown, deactivated, or
 * belonging to a suspended business. Deliberately gives the same answer for all
 * three so it can't be used to probe which codes exist.
 */
export default function QrNotFoundPage() {
  return (
    <main id="main" className="grid min-h-svh place-items-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="bg-muted mx-auto mb-5 grid size-16 place-items-center rounded-2xl">
          <QrCode className="text-muted-foreground size-7" aria-hidden />
        </div>

        <h1 className="text-xl font-semibold tracking-tight">This code isn’t available</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          The QR code you scanned is no longer active. It may have been replaced with a newer
          one — check for an updated code, or ask a member of staff.
        </p>

        <Button asChild variant="outline" className="mt-6">
          <Link href="/">Go to homepage</Link>
        </Button>
      </div>
    </main>
  )
}
