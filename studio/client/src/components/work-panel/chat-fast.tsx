import type { ChatInfo } from '@shared/types'

import { Zap } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/misc'
import { useChatMutations } from '@/lib/chats'
import { useLoadout } from '@/lib/hooks'
import { cn } from '@/lib/utils'

/**
 * ACP exposes fast mode as a session configuration option. The switch belongs to
 * the chat because it follows that resumable session; changing it while a turn
 * runs is allowed and takes effect on the next prompt (an in-flight model request
 * has already selected its service tier).
 */
export function ChatFastToggle({ chat }: { chat?: ChatInfo }) {
  const { data: loadout } = useLoadout(chat?.id, !!chat)
  const { update } = useChatMutations()
  if (!chat || !loadout?.fastMode) return null

  const enabled = chat.fastMode ?? loadout.fastMode.enabled
  const label = enabled ? 'Disable fast mode' : 'Enable fast mode'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={enabled}
          onClick={() => update.mutate({ chatId: chat.id, fastMode: !enabled })}
          className={cn(
            'grid h-7 w-7 place-items-center rounded-md transition-colors',
            enabled
              ? 'bg-warning/15 text-warning hover:bg-warning/25'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <Zap className={cn('h-3.5 w-3.5', enabled && 'fill-current')} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}
        <span className="ml-1.5 text-muted-foreground">
          {loadout.fastMode.description ?? 'faster responses with increased usage'}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
