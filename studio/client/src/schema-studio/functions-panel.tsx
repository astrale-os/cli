import type { StudioSchemaBundle } from '@shared/types'

import { ArrowRight, Box, Braces } from 'lucide-react'

import { AnchorButton } from '@/components/anchor'
import { MethodAuthBadge } from '@/components/method-auth'
import { Chip, EmptyState, Group, IconTile } from '@/components/studio-kit'
import { ScrollArea } from '@/components/ui/misc'
import {
  type FunctionModel,
  type FunctionsModel,
  functionGlyph,
  functionRef,
} from '@/lib/functions'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { SchemaIcon } from './schema-icon'

/**
 * One Function row — click to open its contract in the detail panel.
 *
 * A view row RUNS its view because that is what a view is for; a Function has nothing
 * to run from here, so the click opens what a reader actually wants: input, output and
 * Policy, next to the Action or Workflow that implements it.
 */
export function FunctionRow({ domainId, fn }: { domainId: string; fn: FunctionModel }) {
  const select = useUI((state) => state.selectClass)
  const selected = useUI((state) => state.selectedClass)
  const selectionDomainId = useUI((state) => state.selectionDomainId)
  const ref = functionRef(fn.name)
  const active = selected === ref && selectionDomainId === domainId
  const Glyph = functionGlyph(fn)
  const meta = [
    fn.link?.kind ?? 'contract only',
    fn.boundClasses.length > 0 ? fn.boundClasses.join(' · ') : 'no class',
  ].join(' · ')
  return (
    <div
      data-domain-id={domainId}
      data-anchor-ref={ref}
      data-anchor-excerpt={fn.name}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60',
        active && 'bg-accent',
      )}
    >
      <button
        type="button"
        onClick={() => select(ref, domainId)}
        title={`Open ${fn.name}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <IconTile tone="fn" size="sm">
          <Glyph className="h-3.5 w-3.5" />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium leading-tight">{fn.name}</span>
            <MethodAuthBadge method={fn.fn} domainId={domainId} interactive={false} />
            {fn.contractOnly && <Chip tone="warning">needs handler</Chip>}
            {fn.link?.unlinked && <Chip tone="default">unlinked</Chip>}
          </div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">{meta}</div>
        </div>
      </button>
      <AnchorButton
        domainId={domainId}
        anchorRef={{ ref, kind: 'schema', ...(fn.file ? { file: fn.file } : {}) }}
        excerpt={fn.name}
        className="ml-1"
      />
    </div>
  )
}

/**
 * FunctionsPanel — the domain-wide Functions overview in the RIGHT PANEL.
 *
 * It is the Views panel's twin, and grouped the same way: each header is a Class the
 * Functions beneath it work on (clickable → opens the Class), then the ones that name
 * no Class at all. That grouping is the whole point — a standalone Function declares no
 * receiver, so "which Classes does it touch" is the question the schema cannot answer
 * on its own.
 */
export function FunctionsPanel({
  domainId,
  model,
  bundle,
}: {
  domainId: string
  model: FunctionsModel
  bundle?: StudioSchemaBundle
}) {
  const select = useUI((state) => state.selectClass)
  const boundClasses = [...model.byClass.keys()].sort()
  const classIcon = (cls: string) => bundle?.ir?.classes[cls]?.icon

  return (
    <ScrollArea className="h-full" data-testid="functions-panel">
      <div className="p-5">
        <div className="mb-5 flex items-baseline gap-2 pr-8">
          <h1 className="text-base font-semibold">Functions</h1>
          <span className="text-xs text-muted-foreground">{model.all.length}</span>
        </div>

        {model.all.length === 0 && (
          <EmptyState
            icon={<Braces />}
            title="No functions"
            hint="This domain declares no standalone functions — only class methods."
          />
        )}

        {boundClasses.map((cls) => {
          const icon = classIcon(cls)
          const rows = model.byClass.get(cls)!
          return (
            <section key={cls} className="mb-6">
              <button
                type="button"
                onClick={() => select(`class.${cls}`, domainId)}
                title={`Open ${cls}`}
                className="group mb-1.5 flex w-full items-center gap-1.5 px-1 text-left"
              >
                <span className="shrink-0 text-muted-foreground">
                  {icon ? (
                    <SchemaIcon svg={icon} className="h-4 w-4" />
                  ) : (
                    <Box className="h-4 w-4" />
                  )}
                </span>
                <span className="text-[13px] font-semibold transition-colors group-hover:text-primary">
                  {cls}
                </span>
                <span className="text-[11px] text-muted-foreground">{rows.length}</span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <div className="flex flex-col gap-0.5">
                {rows.map((fn) => (
                  <FunctionRow key={fn.name} domainId={domainId} fn={fn} />
                ))}
              </div>
            </section>
          )
        })}

        {model.standalone.length > 0 && (
          <Group label="Standalone" hint="names no class in this domain">
            <div className="flex flex-col gap-0.5">
              {model.standalone.map((fn) => (
                <FunctionRow key={fn.name} domainId={domainId} fn={fn} />
              ))}
            </div>
          </Group>
        )}
      </div>
    </ScrollArea>
  )
}
