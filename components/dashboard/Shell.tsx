'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, Menu, Search, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth/actions'

export type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  /** Shown as a count pill, e.g. overdue invoices. */
  badge?: number
}

export type NavSection = { title?: string; items: NavItem[] }

/**
 * Sidebar shell shared by the business and admin dashboards.
 *
 * Mobile behaviour is a drawer rather than a squeezed sidebar — a dashboard
 * that only works on a laptop fails the operators who run these businesses
 * from their phone.
 */
export default function Shell({
  sections,
  brandLabel,
  brandSublabel,
  brandEmoji,
  homeHref,
  children,
  userEmail,
  searchAction,
}: {
  sections: NavSection[]
  brandLabel: string
  brandSublabel?: string
  brandEmoji: string
  homeHref: string
  children: React.ReactNode
  userEmail: string
  /** When set, renders the cross-entity search box (§53). */
  searchAction?: string
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === homeHref ? pathname === href : pathname.startsWith(href)

  const nav = (
    <nav className="flex h-full flex-col gap-6 p-4">
      <Link
        href={homeHref}
        onClick={() => setOpen(false)}
        className="flex items-center gap-2.5 px-2 py-1"
      >
        <span className="bg-primary grid size-9 shrink-0 place-items-center rounded-lg text-base">
          {brandEmoji}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{brandLabel}</span>
          {brandSublabel && (
            <span className="text-muted-foreground block truncate text-xs">{brandSublabel}</span>
          )}
        </span>
      </Link>

      {searchAction && (
        <form action={searchAction} className="relative px-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            placeholder="Search…"
            aria-label="Search products, campaigns and codes"
            className="border-input bg-background/60 focus-visible:ring-ring/40 h-9 w-full rounded-lg border pl-9 text-sm outline-none focus-visible:ring-2"
          />
        </form>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto">
        {sections.map((section, i) => (
          <div key={section.title ?? i}>
            {section.title && (
              <p className="text-muted-foreground/70 mb-1.5 px-3 text-[10px] font-semibold tracking-[0.14em] uppercase">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      '[&_svg]:size-4 [&_svg]:shrink-0',
                      isActive(item.href)
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                    )}
                  >
                    {item.icon}
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="bg-destructive/12 text-destructive rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t pt-3">
        <p className="text-muted-foreground mb-2 truncate px-3 text-xs">{userEmail}</p>
        <form action={signOut}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-full justify-start"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </Button>
        </form>
      </div>
    </nav>
  )

  return (
    <div className="bg-muted/20 min-h-svh">
      {/* Desktop sidebar */}
      <aside className="bg-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 border-r lg:block">
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="bg-sidebar fixed inset-y-0 left-0 z-50 w-64 border-r lg:hidden">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="hover:bg-accent absolute top-4 right-3 rounded-lg p-1.5"
            >
              <X className="size-4" aria-hidden />
            </button>
            {nav}
          </aside>
        </>
      )}

      <div className="lg:pl-60">
        <header className="bg-background/85 safe-t sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-lg lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="hover:bg-accent -ml-1.5 rounded-lg p-2"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="truncate text-sm font-semibold">{brandLabel}</span>
        </header>

        <main id="main" className="safe-b p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
