import type { StudioSchemaBundle } from '@shared/types'

import { schemaRefKey } from '@shared/types'
import { ChevronRight, FolderClosed, ShieldCheck } from 'lucide-react'

import { cn } from '@/lib/utils'

export function PoliciesTree({
  bundle,
  selected,
  onSelect,
  indent,
}: {
  bundle: StudioSchemaBundle
  selected?: string
  onSelect: (ref: string) => void
  indent: number
}) {
  const names = Object.keys(bundle.ir?.policies ?? {}).sort()
  if (names.length === 0) return null
  return (
    <details
      className="group/policies pb-1.5 text-[13px]"
      data-testid="schema-policies"
      data-domain-id={bundle.domainId}
    >
      <summary
        style={{ paddingLeft: indent + 8 }}
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 pr-2 font-medium hover:bg-accent"
      >
        <ChevronRight className="h-3 w-3 text-muted-foreground transition-transform group-open/policies:rotate-90" />
        <FolderClosed className="h-3.5 w-3.5 text-success" /> Policies
      </summary>
      {names.map((name) => {
        const ref = `policy.${schemaRefKey({ origin: bundle.ir!.domain, kind: 'policy', name })}`
        return (
          <button
            key={name}
            type="button"
            onClick={() => onSelect(ref)}
            aria-pressed={selected === ref}
            style={{ paddingLeft: indent + 32 }}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-accent',
              selected === ref && 'bg-accent',
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" />
            <span className="truncate">{name}</span>
          </button>
        )
      })}
    </details>
  )
}
