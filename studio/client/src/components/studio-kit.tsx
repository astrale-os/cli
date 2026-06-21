import { ChevronRight } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

/**
 * Studio kit — the shared elegant building blocks for every section.
 * Principles: airy spacing, minimal text, icons over labels, friendly by
 * default with power-user detail one click away (DetailsDisclosure / HoverCard).
 */

// ── SectionShell: one consistent, breathable frame per section ──
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
      <div className={cn('mx-auto px-8 pt-8 pb-28', wide ? 'max-w-6xl' : 'max-w-3xl', className)}>
        <header className="flex items-start gap-3 mb-7">
          {icon && <div className="text-muted-foreground mt-0.5">{icon}</div>}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
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
    <section className={cn('mb-8', className)}>
      {label && (
        <div className="flex items-baseline justify-between mb-2.5 px-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </h2>
          {hint != null && <span className="text-xs text-muted-foreground/70">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

// ── Card surface (soft) ──
export function Surface({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border bg-card', className)} {...props} />
}

// ── IconTile: a rounded square holding an icon, tinted ──
const TONES: Record<string, string> = {
  violet: 'bg-primary/12 text-primary',
  sky: 'bg-sky-500/12 text-sky-400',
  emerald: 'bg-emerald-500/12 text-emerald-400',
  amber: 'bg-amber-500/12 text-amber-400',
  rose: 'bg-rose-500/12 text-rose-400',
  fuchsia: 'bg-fuchsia-500/12 text-fuchsia-400',
  muted: 'bg-muted text-muted-foreground',
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
  size?: 'sm' | 'md' | 'lg'
  className?: string
  style?: React.CSSProperties
}) {
  const sz =
    size === 'lg'
      ? 'h-10 w-10 [&_svg]:h-5 [&_svg]:w-5'
      : size === 'sm'
        ? 'h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5'
        : 'h-9 w-9 [&_svg]:h-[18px] [&_svg]:w-[18px]'
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-lg shrink-0',
        TONES[tone] ?? tone,
        sz,
        className,
      )}
      style={style}
    >
      {children}
    </div>
  )
}

// ── Row: an airy list item with leading icon + title/subtitle + trailing ──
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  active,
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
        'group/row w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
        onClick && 'hover:bg-accent/60 cursor-pointer',
        active && 'bg-accent',
        className,
      )}
    >
      {leading}
      {(title || subtitle) && (
        <div className="flex-1 min-w-0">
          {title && <div className="text-sm font-extrabold truncate">{title}</div>}
          {subtitle && (
            <div className="text-[13px] text-muted-foreground truncate leading-snug">
              {subtitle}
            </div>
          )}
        </div>
      )}
      {children}
      {trailing && <div className="shrink-0 flex items-center gap-1.5">{trailing}</div>}
    </Comp>
  )
}

// ── Chip: a soft, refined pill ──
const CHIP: Record<string, string> = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/12 text-destructive',
  fuchsia: 'bg-fuchsia-500/12 text-fuchsia-300',
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
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        CHIP[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

// ── DetailsDisclosure: subtle power-user expander ──
export function DetailsDisclosure({
  label = 'Details',
  children,
  className,
}: {
  label?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Collapsible className={className}>
      <CollapsibleTrigger className="group/disc inline-flex items-center gap-1 text-xs text-muted-foreground/80 hover:text-foreground transition-colors">
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]/disc:rotate-90" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out">
        <div className="pt-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ── MetaGrid: key/value pairs for technical detail (inside disclosure / hovercard) ──
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
          <dt className="text-muted-foreground/70 whitespace-nowrap">{it.label}</dt>
          <dd className="font-mono text-muted-foreground break-all">{it.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

// ── CodeBlock: a small monospace source snippet (hovercards / detail) ──
export function CodeBlock({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <pre
      className={cn(
        'max-h-56 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words',
        className,
      )}
    >
      {children}
    </pre>
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
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {icon && <div className="text-muted-foreground/40 mb-3 [&_svg]:h-8 [&_svg]:w-8">{icon}</div>}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">{hint}</p>}
    </div>
  )
}
