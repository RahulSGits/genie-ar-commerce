/**
 * Design system primitives.
 *
 * Deliberately one module: the set is small, every piece shares the same token
 * vocabulary, and keeping them together makes the visual language easy to audit
 * in one read. Anything that grows its own behaviour (data tables, charts,
 * uploaders) lives in its own file.
 */
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/* ── Button ─────────────────────────────────────────────────────────────── */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ' +
    'transition-[color,background-color,border-color,opacity,transform] outline-none ' +
    'focus-visible:ring-ring/60 focus-visible:ring-[3px] active:scale-[0.98] ' +
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
        outline: 'border-input bg-background hover:bg-accent hover:text-accent-foreground border',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // 44px min target on the default and lg sizes — thumb-friendly on mobile.
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-12 rounded-xl px-6 text-base',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }

/* ── Card ───────────────────────────────────────────────────────────────── */

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('bg-card text-card-foreground rounded-xl border shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('leading-none font-semibold tracking-tight', className)} {...props} />
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-muted-foreground text-sm', className)} {...props} />
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center p-5 pt-0', className)} {...props} />
}

/* ── Input / Textarea / Label ───────────────────────────────────────────── */

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'border-input bg-background flex h-10 w-full rounded-lg border px-3 py-2 text-sm',
        'placeholder:text-muted-foreground',
        'focus-visible:ring-ring/60 focus-visible:border-ring focus-visible:ring-[3px] outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/25',
        // 16px on mobile stops iOS Safari zooming the viewport on focus.
        'text-base md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'border-input bg-background flex min-h-20 w-full rounded-lg border px-3 py-2 text-sm',
        'placeholder:text-muted-foreground',
        'focus-visible:ring-ring/60 focus-visible:border-ring focus-visible:ring-[3px] outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'text-base md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'text-sm leading-none font-medium select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'border-input bg-background flex h-10 w-full rounded-lg border px-3 py-2 text-sm',
        'focus-visible:ring-ring/60 focus-visible:border-ring focus-visible:ring-[3px] outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'text-base md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

/** Label + control + error, so forms stay consistent and accessible. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-xs">{hint}</p>}
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/* ── Badge ──────────────────────────────────────────────────────────────── */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/15 text-warning-foreground',
        destructive: 'border-transparent bg-destructive/12 text-destructive',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

/* ── Alert ──────────────────────────────────────────────────────────────── */

export function Alert({
  variant = 'default',
  className,
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'destructive' | 'warning' | 'success' }) {
  const styles = {
    default: 'bg-muted/50 border-border',
    destructive: 'bg-destructive/8 border-destructive/25 text-destructive',
    warning: 'bg-warning/10 border-warning/30',
    success: 'bg-success/10 border-success/25',
  }
  return (
    <div
      role="alert"
      className={cn('rounded-lg border px-4 py-3 text-sm', styles[variant], className)}
      {...props}
    />
  )
}

/* ── Skeleton ───────────────────────────────────────────────────────────── */

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />
}

/* ── EmptyState ─────────────────────────────────────────────────────────── */

/**
 * Every list gets one of these. An empty table with no explanation reads as a
 * bug; an empty state that names the next action reads as onboarding.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center',
        className,
      )}
    >
      {icon && <div className="text-muted-foreground/50 [&_svg]:size-9">{icon}</div>}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && (
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/* ── Stat ───────────────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  hint,
  trend,
  icon,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  trend?: { value: number; label?: string }
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground truncate text-xs font-medium tracking-wide uppercase">
            {label}
          </p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
          {trend && (
            <p
              className={cn(
                'text-xs font-medium',
                trend.value >= 0 ? 'text-success' : 'text-destructive',
              )}
            >
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%{' '}
              {trend.label && <span className="text-muted-foreground">{trend.label}</span>}
            </p>
          )}
        </div>
        {icon && <div className="text-muted-foreground/40 [&_svg]:size-5">{icon}</div>}
      </div>
    </Card>
  )
}

/* ── Table ──────────────────────────────────────────────────────────────── */

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    // Wrapper scrolls, not the page — wide tables must never break mobile layout.
    <div className="scroll-x w-full">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}

export function TBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TR({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr className={cn('hover:bg-muted/40 border-b transition-colors', className)} {...props} />
}

export function TH({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'text-muted-foreground h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap',
        className,
      )}
      {...props}
    />
  )
}

export function TD({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-3 align-middle', className)} {...props} />
}

/* ── Progress ───────────────────────────────────────────────────────────── */

export function Progress({
  value,
  className,
  indicatorClassName,
}: {
  /** 0–100. Null renders an indeterminate bar. */
  value: number | null
  className?: string
  indicatorClassName?: string
}) {
  return (
    <div
      className={cn('bg-muted h-2 w-full overflow-hidden rounded-full', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
    >
      <div
        className={cn('bg-primary h-full rounded-full transition-[width] duration-300', indicatorClassName)}
        style={{ width: `${Math.min(100, Math.max(0, value ?? 100))}%` }}
      />
    </div>
  )
}

/* ── Separator ──────────────────────────────────────────────────────────── */

export function Separator({ className, ...props }: React.ComponentProps<'div'>) {
  return <div role="separator" className={cn('bg-border h-px w-full', className)} {...props} />
}

/* ── Switch ─────────────────────────────────────────────────────────────── */

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'focus-visible:ring-ring/60 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:ring-[3px] outline-none disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
        className,
      )}
    >
      <span
        className={cn(
          'bg-background pointer-events-none block size-5 rounded-full shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
