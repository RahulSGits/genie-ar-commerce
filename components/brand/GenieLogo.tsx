import { cn } from '@/lib/utils'

/**
 * The GENIE mark.
 *
 * An abstract G formed by an open scanning ring, with a cube nested inside it
 * and a spark at the ring's opening. The three ideas the product is built on —
 * scan, 3D object, AI — in one shape, rather than three icons stapled together.
 *
 * Drawn on a 32×32 grid with generous stroke weights so it survives being
 * rendered at favicon size. It inherits `currentColor`, so it works on any
 * surface without a second inverted asset.
 */
export function GenieMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="GENIE"
      className={cn('size-8', className)}
    >
      {/* Scanning ring, open at the upper right — reads as a G. */}
      <path
        d="M25.5 9.4A11 11 0 1 0 27 16h-9"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* Isometric cube: the 3D object being scanned. */}
      <path
        d="M16 11.6l4.4 2.5v5l-4.4 2.5-4.4-2.5v-5L16 11.6z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <path
        d="M16 11.6v4.9m0 0l4.4-2.4M16 16.5l-4.4-2.4M16 16.5v5.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* AI spark at the ring's opening. */}
      <path
        d="M26.6 5.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * Full lockup. `tone="onDark"` is for the marketing hero, where the mark sits
 * on a dark navy field and needs the violet to come from the accent rather than
 * from the text colour.
 */
export function GenieLogo({
  className,
  markClassName,
  showWordmark = true,
  tone = 'auto',
}: {
  className?: string
  markClassName?: string
  showWordmark?: boolean
  tone?: 'auto' | 'onDark'
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className={cn(
          'grid place-items-center rounded-lg',
          tone === 'onDark' ? 'text-primary' : 'text-primary',
          markClassName,
        )}
      >
        <GenieMark className="size-7" />
      </span>
      {showWordmark && (
        <span
          className={cn(
            'text-[1.05rem] font-semibold tracking-[0.14em]',
            tone === 'onDark' ? 'text-white' : 'text-foreground',
          )}
        >
          GENIE
        </span>
      )}
    </span>
  )
}

/** Solid-tile variant for sidebars and avatars, where the mark needs a ground. */
export function GenieBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-xl',
        className,
      )}
    >
      <GenieMark className="size-5" />
    </span>
  )
}
