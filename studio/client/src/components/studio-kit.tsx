import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Studio kit — the shared building blocks every section is composed from.
 * One frame per section, one list idiom, one chip idiom. Tones name what a
 * thing IS in the schema grammar (node / edge / view / core / function), never
 * a raw colour, so a token change repaints the whole studio.
 */

// ── SectionShell: one consistent frame per section ──
export function SectionShell({
  title,
  subtitle,
  icon,
  actions,
  children,
  wide,
  className,
}: {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
  className?: string
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('mx-auto px-8 pt-7 pb-16', wide ? 'max-w-6xl' : 'max-w-3xl', className)}>
        <header className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
          {icon && <div className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</div>}
          <div className="min-w-0 flex-1 basis-56">
            <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}

// ── Group: a labelled block within a section ──
export function Group({
  label,
  hint,
  children,
  className,
}: {
  label?: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('mb-7', className)}>
      {label && (
        <div className="mb-2 flex items-baseline justify-between px-0.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </h2>
          {hint != null && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

// ── Surface: the one card ──
export function Surface({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-card', className)} {...props} />
}

/** Domain-authored prose, visually distinct from structural labels and values. */
export function DescriptionText({ className, ...props }: React.ComponentPropsWithRef<'p'>) {
  return <p data-description="" className={cn('italic', className)} {...props} />
}

// ── IconTile: a rounded square holding an icon, tinted by schema role ──
const TONES: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  node: 'bg-schema-node/10 text-schema-node',
  edge: 'bg-schema-edge/12 text-schema-edge',
  view: 'bg-schema-view/10 text-schema-view',
  core: 'bg-schema-core/10 text-schema-core',
  fn: 'bg-schema-function/10 text-schema-function',
  muted: 'bg-muted text-muted-foreground',
}
const TILE_SIZES = {
  sm: 'h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5',
  md: 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4',
  lg: 'h-9 w-9 [&_svg]:h-[18px] [&_svg]:w-[18px]',
}
export function IconTile({
  children,
  tone = 'muted',
  size = 'md',
  className,
  style,
}: {
  children: React.ReactNode
  tone?: keyof typeof TONES | string
  size?: keyof typeof TILE_SIZES
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md',
        TONES[tone] ?? tone,
        TILE_SIZES[size],
        className,
      )}
      style={style}
    >
      {children}
    </div>
  )
}

// ── Row: the one list item — leading icon + title/subtitle + trailing ──
// `dense` is the same idiom at table weight: the subtitle moves off its own line
// and onto the title's, pinned right. A field's name and its type are one fact,
// so a list of them reads as two columns instead of stacked pairs — the same rows
// in roughly half the height, which is what makes long member lists scannable.
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  active,
  dense,
  className,
  children,
  anchorRef,
  anchorExcerpt,
}: {
  leading?: React.ReactNode
  title?: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  onClick?: () => void
  active?: boolean
  /** single-line variant: subtitle sits right-aligned on the title's line */
  dense?: boolean
  className?: string
  children?: React.ReactNode
  /** makes the whole row a commentable target surface (comment mode) */
  anchorRef?: string
  anchorExcerpt?: string
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      data-anchor-ref={anchorRef}
      data-anchor-excerpt={anchorExcerpt}
      data-commentable={anchorRef ? '' : undefined}
      className={cn(
        'group/row flex w-full items-center rounded-md text-left transition-colors',
        dense ? 'gap-2 px-2.5 py-1' : 'gap-2.5 px-2.5 py-2',
        onClick && 'cursor-pointer hover:bg-accent',
        active && 'bg-accent',
        className,
      )}
    >
      {leading}
      {dense ? (
        <>
          {title && (
            <div className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5">{title}</div>
          )}
          {subtitle && (
            // caps at half the row so a long type never crowds out the name it
            // describes; `ml-auto` keeps it on the right edge even with no title
            <div className="ml-auto min-w-0 max-w-[50%] truncate text-right text-xs text-muted-foreground">
              {subtitle}
            </div>
          )}
        </>
      ) : (
        (title || subtitle) && (
          <div className="min-w-0 flex-1">
            {title && <div className="truncate text-[13px] font-medium">{title}</div>}
            {subtitle && (
              <div className="truncate text-xs leading-snug text-muted-foreground">{subtitle}</div>
            )}
          </div>
        )
      )}
      {children}
      {trailing && <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>}
    </Comp>
  )
}

// ── Chip: one pill ──
const CHIP: Record<string, string> = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/14 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  node: 'bg-schema-node/10 text-schema-node',
  edge: 'bg-schema-edge/12 text-schema-edge',
  fn: 'bg-schema-function/10 text-schema-function',
  outline: 'border border-border text-muted-foreground',
}
export function Chip({
  children,
  tone = 'default',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof CHIP }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
        CHIP[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

// ── MetaGrid: key/value technical detail ──
export function MetaGrid({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[]
  className?: string
}) {
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs', className)}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <dt className="whitespace-nowrap text-muted-foreground">{it.label}</dt>
          <dd className="break-all font-mono text-foreground/80">{it.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

// ── EmptyState ──
export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: React.ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && <div className="mb-2.5 text-muted-foreground [&_svg]:h-6 [&_svg]:w-6">{icon}</div>}
      <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
