import { HelpCircle } from 'lucide-react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

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
