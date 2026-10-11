import type { ReactNode, SelectHTMLAttributes } from 'react'

import { HelpCircle } from 'lucide-react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'

/** The small caps title over one group of settings. */
export function SettingsHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

/** One setting: what it is on the left, the control that changes it on the right. */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** The one dropdown used across Settings. */
export function SettingSelect<T extends string>({
  options,
  onValue,
  className,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  options: readonly { value: T; label: string }[]
  onValue: (value: T) => void
}) {
  return (
    <select
      className={cn(
        'h-8 w-52 rounded-md border bg-card px-2 text-[13px] outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:text-muted-foreground',
        className,
      )}
      onChange={(event) => onValue(event.target.value as T)}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** Compact contextual help shared by Settings controls. */
export function SettingsHint({ text }: { text: string }) {
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="What's this?"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-xs text-[13px] leading-relaxed text-muted-foreground">
        {text}
      </HoverCardContent>
    </HoverCard>
  )
}
