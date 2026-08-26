/** Method security affordance: badge (row glyph + hover), card, inline chip. */
import { Chip, IconTile } from '@/components/studio-kit'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { type AuthCallable, methodAuth } from '@/lib/method-auth'
import { cn } from '@/lib/utils'

const TRIGGER_TONE: Record<string, string> = {
  emerald: 'text-success',
  sky: 'text-schema-node',
  amber: 'text-warning',
  rose: 'text-destructive',
}

interface MethodAuthProps {
  method?: AuthCallable
}

interface MethodAuthBadgeProps extends MethodAuthProps {
  /** Use a non-interactive trigger when the badge sits inside a clickable Row. */
  interactive?: boolean
}

/** Row glyph; hover reveals the full card. */
export function MethodAuthBadge({ method, interactive = true }: MethodAuthBadgeProps) {
  const v = methodAuth(method)
  if (!v) return null
  const Icon = v.icon
  const triggerClassName = cn(
    'inline-flex items-center justify-center rounded-md transition-colors',
    TRIGGER_TONE[v.tone],
  )
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        {interactive ? (
          <button
            type="button"
            aria-label={`Authorization: ${v.label}`}
            className={triggerClassName}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span role="img" aria-label={`Authorization: ${v.label}`} className={triggerClassName}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96 p-0 overflow-hidden">
        <MethodAuthCard method={method} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** Full verdict from the canonical callable authentication contract. */
export function MethodAuthCard({ method }: MethodAuthProps) {
  const v = methodAuth(method)
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
          </div>
          <p className="mt-1 leading-relaxed text-muted-foreground">{v.blurb}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-t px-3 py-2">
        <Chip tone="outline" className="font-mono">
          auth: {v.auth}
        </Chip>
      </div>
    </div>
  )
}
