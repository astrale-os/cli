/** Method security affordance: badge (row glyph + hover), card, inline chip. */
import type { HandlerLink } from '@shared/types'

import { Chip, CodeBlock, IconTile } from '@/components/studio-kit'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { methodAuth } from '@/lib/method-auth'
import { cn } from '@/lib/utils'

const TRIGGER_TONE: Record<string, string> = {
  emerald: 'text-emerald-400 hover:text-emerald-300',
  sky: 'text-sky-400 hover:text-sky-300',
  amber: 'text-amber-400 hover:text-amber-300',
  rose: 'text-rose-400 hover:text-rose-300',
}

/** Row glyph; hover reveals the full card. */
export function MethodAuthBadge({ link }: { link?: HandlerLink }) {
  const v = methodAuth(link)
  if (!v) return null
  const Icon = v.icon
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`Authorization: ${v.label}`}
          className={cn(
            'inline-flex items-center justify-center rounded-md transition-colors',
            TRIGGER_TONE[v.tone],
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96 p-0 overflow-hidden">
        <MethodAuthCard link={link} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** Full verdict: headline, auth/authorize chips, authorize + handler source. */
export function MethodAuthCard({ link }: { link?: HandlerLink }) {
  const v = methodAuth(link)
  if (!v) return null
  const Icon = v.icon
  return (
    <div className="text-[13px]">
      <div className="flex items-start gap-2.5 p-3">
        <IconTile tone={v.tone} size="sm">
          <Icon />
        </IconTile>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{v.label}</span>
            {v.warn && <Chip tone={v.chipTone}>review</Chip>}
          </div>
          <p className="mt-1 leading-relaxed text-muted-foreground">{v.blurb}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-t px-3 py-2">
        <Chip tone="outline" className="font-mono">
          auth: {v.auth}
        </Chip>
        <Chip tone="outline" className="font-mono">
          authorize: {v.authorize}
        </Chip>
      </div>

      {v.authorize === 'custom' && link?.authorizeSnippet && (
        <div className="border-t px-3 py-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            authorize
          </p>
          <CodeBlock>{link.authorizeSnippet}</CodeBlock>
        </div>
      )}
    </div>
  )
}
