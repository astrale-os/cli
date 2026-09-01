import type { HarnessPresence } from '@shared/types'

import { HarnessLogo } from '@/components/harness-logo'
import { brandTone } from '@/components/work-panel/chat-tone'
import { cn } from '@/lib/utils'

/**
 * One local agent, as this machine has it.
 *
 * Read-only on purpose: nothing here is a setting. Which agent a conversation
 * runs is decided where you talk to it — pick a model and you have picked its
 * agent — so all Settings owes you is the answer to "is it installed, and what
 * answered when Studio asked?".
 */
export function HarnessPresenceRow({ presence }: { presence: HarnessPresence }) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <HarnessLogo
        harness={presence.id}
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          presence.ok ? brandTone(presence.id).mark : 'text-muted-foreground/50',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px]">{presence.label}</span>
          <span
            className={cn(
              'ml-auto shrink-0 font-mono text-[11px]',
              presence.ok ? 'text-muted-foreground' : 'text-destructive',
            )}
          >
            {presence.ok ? (presence.version ?? 'detected') : 'not detected'}
          </span>
          <span
            aria-hidden
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              presence.ok ? 'bg-success' : 'bg-destructive',
            )}
          />
        </div>
        {/* the ACP handshake when it answered, the reason when it did not — both
            are what someone opening this panel came to read */}
        <p
          className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground"
          title={presence.message}
        >
          {presence.message}
        </p>
      </div>
    </div>
  )
}
