import type { DefinitionLink, StudioSchemaBundle } from '@shared/contracts/schema'

import { PenLine, Search } from 'lucide-react'
import { useMemo } from 'react'

import { Chip, DescriptionText, Group, IconTile, MetaGrid } from '@/components/studio-kit'
import { useUI } from '@/lib/store'

import { callableTarget, definitionUsers } from '../definitions'

/**
 * A Query or Mutation definition. It answers what it IS (the header and where it is
 * declared), what it WORKS ON (the Classes its `build` names) and WHO USES IT (the
 * callables whose handlers reach it), each Class and callable a click away.
 */
export function DefinitionDetail({
  bundle,
  definition,
}: {
  bundle: StudioSchemaBundle
  definition: DefinitionLink
}) {
  const selectClass = useUI((state) => state.selectClass)
  const users = useMemo(
    () => definitionUsers(bundle.overlay.handlerLinks).get(definition.id) ?? [],
    [bundle, definition.id],
  )
  const Glyph = definition.kind === 'query' ? Search : PenLine
  const open = (target: string) => selectClass(target, bundle.domainId)
  const classes = definition.classes.filter((name) => bundle.ir?.classes[name])
  return (
    <div data-comment-outline-inset="" className="h-full overflow-y-auto">
      <div className="space-y-6 px-5 py-5">
        <header className="space-y-3">
          <div className="flex items-start gap-3 pr-8">
            <IconTile
              tone={definition.kind === 'query' ? 'fn' : 'bg-warning/14 text-warning'}
              size="lg"
            >
              <Glyph />
            </IconTile>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold tracking-tight">
                  {definition.name ?? definition.id}
                </h2>
                <Chip tone="outline">{definition.kind}</Chip>
              </div>
              {definition.name && (
                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {definition.id}
                </div>
              )}
            </div>
          </div>
          {definition.doc && <DescriptionText>{definition.doc}</DescriptionText>}
        </header>

        {classes.length > 0 && (
          <Group label="Works on">
            <ChipLinks
              items={classes.map((name) => ({ label: name, target: `class.${name}` }))}
              onOpen={open}
            />
          </Group>
        )}

        <Group label="Used by">
          {users.length > 0 ? (
            <ChipLinks
              items={users.map((key) => ({ label: key, target: callableTarget(key) }))}
              onOpen={open}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No handler names it.</p>
          )}
        </Group>

        <Group label="Source">
          <MetaGrid
            items={[{ label: 'Declared in', value: `${definition.file}:${definition.line}` }]}
          />
        </Group>
      </div>
    </div>
  )
}

function ChipLinks({
  items,
  onOpen,
}: {
  items: { label: string; target: string }[]
  onOpen: (target: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map(({ label, target }) => (
        <button
          key={label}
          type="button"
          title={`Open ${label}`}
          onClick={() => onOpen(target)}
          className="rounded-full"
        >
          <Chip
            tone="outline"
            className="transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            {label}
          </Chip>
        </button>
      ))}
    </div>
  )
}
