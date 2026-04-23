import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

interface InspectorSectionProps {
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
}

export function InspectorSection({
  title,
  count,
  defaultOpen = false,
  children,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground tracking-wider mb-1.5 hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        {title}
        {count !== undefined && (
          <span className="ml-auto text-[9px] font-normal normal-case tracking-normal opacity-60">
            {count}
          </span>
        )}
      </button>
      {open && children}
    </div>
  )
}
