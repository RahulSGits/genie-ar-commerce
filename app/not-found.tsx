import Link from 'next/link'
import { Compass, Home, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui'

export const metadata = { title: 'Page not found' }

/**
 * Global 404.
 *
 * Reads no data on purpose: this file is prerendered at build time, so a call
 * into the database here would run before the database exists.
 */
export default function NotFound() {
  return (
    <main id="main" className="grid min-h-svh place-items-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="bg-muted mx-auto mb-6 grid size-16 place-items-center rounded-2xl">
          <Compass className="text-muted-foreground size-7" aria-hidden />
        </div>

        <p className="text-muted-foreground text-sm font-medium tracking-[0.14em] uppercase">
          Error 404
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">This page doesn’t exist</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          The link may be out of date, or the address may have a typo in it. Nothing is broken on
          your end.
        </p>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/">
              <Home className="size-4" aria-hidden />
              Go to homepage
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/ar/urban-bites/signature-burger">
              <Smartphone className="size-4" aria-hidden />
              Try the AR demo
            </Link>
          </Button>
        </div>

        <p className="text-muted-foreground/70 mt-5 text-xs">
          The demo is a real product page — open it on a phone to place the model on your table.
        </p>

        <div className="text-muted-foreground mt-10 flex flex-wrap justify-center gap-4 border-t pt-6 text-xs">
          <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
          <Link href="/login" className="hover:text-foreground">Business sign in</Link>
          <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
        </div>
      </div>
    </main>
  )
}
