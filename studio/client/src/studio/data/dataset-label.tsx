/**
 * The open dataset's name, standing at the top left of the Data level's canvas in the Data accent:
 * which level is read, and which dataset, at a glance. Clicked, it opens the Domain's Datasets
 * page, where another one is picked.
 */

import { LayoutGrid } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { CanvasToolbar } from '../../schema-studio/canvas-toolbar'
import { DATA_ACCENT, DATA_GLYPH } from './accent'

export function DatasetLabel({ name, origin }: { name: string; origin: string }) {
  const openDataLevel = useUI((s) => s.openDataLevel)
  return (
    <CanvasToolbar>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="dataset-label"
            onClick={() => openDataLevel(null)}
            className={cn(
              'inline-flex h-7 min-w-0 max-w-72 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors hover:bg-primary/10 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0',
              DATA_ACCENT,
            )}
          >
            <DATA_GLYPH aria-hidden />
            <span className="truncate">{name}</span>
            <LayoutGrid aria-hidden className="text-muted-foreground" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Every dataset of {origin}</TooltipContent>
      </Tooltip>
    </CanvasToolbar>
  )
}
