import type { ReactNode, SelectHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

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
export function SettingSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 w-52 rounded-md border bg-card px-2 text-[13px] outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
