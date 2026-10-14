import type * as React from 'react'

import { cn } from '@/lib/utils'

/** A placeholder block shaped like the content it stands in for, while that content loads. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={cn('block animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}
