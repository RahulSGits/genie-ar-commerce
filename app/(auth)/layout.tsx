import Link from 'next/link'
import { getBranding } from '@/lib/db/repositories/platform'

export const dynamic = 'force-dynamic'

/** Shared shell for sign-in / sign-up. Centred, quiet, mobile-first. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const branding = getBranding()

  return (
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2 font-semibold tracking-tight"
        >
          <span className="bg-primary grid size-8 place-items-center rounded-lg text-base">
            {branding.faviconEmoji}
          </span>
          {branding.name}
        </Link>
        <main id="main">{children}</main>
      </div>
    </div>
  )
}
