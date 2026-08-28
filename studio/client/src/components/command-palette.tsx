import { Command } from 'cmdk'
import { AppWindow, ArrowRight, Box, Folder, Globe, Plug, Spline, Tag } from 'lucide-react'
import { useEffect, useMemo } from 'react'

import { useBundle } from '@/lib/hooks'
import { type SectionKey, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { folderModules, moduleOfClass } from '@/schema-studio/modules'

/** The nav sections, mirroring app.tsx's NAV order/labels. */
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'schema', label: 'Schema' },
  { key: 'core', label: 'Core' },
  { key: 'process', label: 'Process' },
]

/** The domain-level overviews. They open in the schema section's right panel —
 *  reachable from here rather than from a permanent row of canvas buttons. */
const OVERVIEWS: { key: 'domains' | 'views' | 'integrations'; label: string; icon: typeof Box }[] =
  [
    { key: 'domains', label: 'Imported domains', icon: Globe },
    { key: 'views', label: 'Views', icon: AppWindow },
    { key: 'integrations', label: 'Integrations', icon: Plug },
  ]

/** Summarise a JSON Schema property type for the muted meta column. */
function propTypeLabel(
  schema:
    | { type?: string | string[]; enum?: unknown[]; items?: { type?: string | string[] } }
    | undefined,
  optionalOverride?: boolean,
): string {
  if (!schema) return 'unknown'
  if (Array.isArray(schema.enum) && schema.enum.length) return optionalOverride ? 'enum?' : 'enum'
  const t = schema.type
  if (Array.isArray(t)) {
    const base = t.filter((x) => x !== 'null')
    const optional = optionalOverride ?? t.includes('null')
    const name = base.length === 1 ? base[0] : base.join(' | ') || 'unknown'
    return optional ? `${name}?` : name
  }
  const label =
    t === 'array' ? `${schema.items?.type ?? 'unknown'}[]` : ((t as string) ?? 'unknown')
  return optionalOverride ? `${label}?` : label
}

/** Row icon + label + muted meta — the shared visual for every item. */
function Row({
  icon: Icon,
  label,
  meta,
}: {
  icon: typeof Box
  label: React.ReactNode
  meta?: string
}) {
  return (
    <>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{label}</span>
      {meta ? (
        <span className="ml-2 shrink-0 truncate text-xs text-muted-foreground">{meta}</span>
      ) : null}
    </>
  )
}

const ITEM_CLS =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  const setPaletteOpen = useUI((s) => s.setPaletteOpen)
  const domainId = useUI((s) => s.domainId)
  const setSection = useUI((s) => s.setSection)
  const selectClass = useUI((s) => s.selectClass)
  const focusClass = useUI((s) => s.focusClass)
  const revealOnCanvas = useUI((s) => s.revealOnCanvas)
  const setPanelOverlay = useUI((s) => s.setPanelOverlay)

  const { data: bundle } = useBundle(domainId)

  // Global Cmd/Ctrl+K toggles the palette. (cmdk's Dialog handles Esc to close.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setPaletteOpen(!useUI.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  const close = () => setPaletteOpen(false)

  // Build the searchable index from the schema IR (memoised on the bundle).
  const index = useMemo(() => {
    const ir = bundle?.ir
    if (!ir || !bundle) {
      return { classes: [], edges: [], properties: [], modules: [] }
    }

    const classes = Object.values(ir.classes)
      .filter((c) => c.type === 'node')
      .map((c) => {
        const propCount = Object.keys(c.properties).length
        const methodCount = Object.keys(c.methods).length
        const mod = moduleOfClass(bundle, c.name)
        const counts = [
          propCount > 0 ? `${propCount} propert${propCount === 1 ? 'y' : 'ies'}` : '',
          methodCount > 0 ? `${methodCount} method${methodCount === 1 ? '' : 's'}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
        return {
          name: c.name,
          value: `class ${c.name} ${mod} ${counts}`,
          meta: [mod === 'root' ? '' : mod, counts].filter(Boolean).join(' · '),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const edges = Object.values(ir.classes)
      .filter((c) => c.type === 'edge')
      .map((e) => {
        const [src, tgt] = e.endpoints ?? []
        const srcT = src?.types.join('|') ?? '?'
        const tgtT = tgt?.types.join('|') ?? '?'
        return {
          name: e.name,
          value: `edge ${e.name} ${srcT} ${tgtT} relationship`,
          meta: `${srcT} → ${tgtT}`,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    type Prop = {
      id: string
      owner: string
      prop: string
      value: string
      meta: string
    }
    const properties: Prop[] = []
    for (const c of Object.values(ir.classes)) {
      if (c.type !== 'node') continue
      for (const [prop, schema] of Object.entries(c.properties)) {
        const optional = c.required ? !c.required.includes(prop) : undefined
        properties.push({
          id: `class.${c.name}.property.${prop}`,
          owner: c.name,
          prop,
          value: `${c.name}.${prop} property ${propTypeLabel(schema, optional)}`,
          meta: propTypeLabel(schema, optional),
        })
      }
    }
    properties.sort((a, b) => a.value.localeCompare(b.value))

    const modules = folderModules(bundle).map((m) => {
      const n = m.classes.length + m.edges.length
      return {
        path: m.path,
        firstClass: m.classes[0],
        value: `module ${m.path} ${m.classes.join(' ')} ${m.edges.join(' ')}`,
        meta: `${n} member${n === 1 ? '' : 's'}`,
      }
    })

    return { classes, edges, properties, modules }
  }, [bundle])

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setPaletteOpen}
      label="Command palette"
      shouldFilter
      // The Radix overlay that cmdk renders.
      overlayClassName="fixed inset-0 z-50 bg-foreground/20"
      contentClassName={cn(
        'fixed left-1/2 top-[15%] z-50 w-full max-w-[640px] -translate-x-1/2',
        'overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl',
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        '[&_[cmdk-group-heading]]:text-muted-foreground',
      )}
    >
      <div className="flex items-center border-b px-3">
        <Command.Input
          autoFocus
          placeholder="Search the schema…"
          className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <Command.List className="max-h-[60vh] overflow-y-auto overflow-x-hidden p-2">
        <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
          No results
        </Command.Empty>

        {index.classes.length > 0 && (
          <Command.Group heading="Classes">
            {index.classes.map((c) => (
              <Command.Item
                key={`class.${c.name}`}
                value={c.value}
                className={ITEM_CLS}
                onSelect={() => {
                  setSection('schema')
                  focusClass(`class.${c.name}`)
                  revealOnCanvas(`class.${c.name}`)
                  close()
                }}
              >
                <Row icon={Box} label={c.name} meta={c.meta} />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {index.edges.length > 0 && (
          <Command.Group heading="Relationships">
            {index.edges.map((e) => (
              <Command.Item
                key={`edge.${e.name}`}
                value={e.value}
                className={ITEM_CLS}
                onSelect={() => {
                  setSection('schema')
                  selectClass(`class.${e.name}`)
                  revealOnCanvas(`class.${e.name}`)
                  close()
                }}
              >
                <Row
                  icon={Spline}
                  label={
                    <>
                      {e.name} <span className="text-xs text-muted-foreground">({e.meta})</span>
                    </>
                  }
                />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {index.properties.length > 0 && (
          <Command.Group heading="Properties">
            {index.properties.map((p) => (
              <Command.Item
                key={p.id}
                value={p.value}
                className={ITEM_CLS}
                onSelect={() => {
                  setSection('schema')
                  focusClass(`class.${p.owner}`)
                  revealOnCanvas(`class.${p.owner}`)
                  close()
                }}
              >
                <Row
                  icon={Tag}
                  label={
                    <>
                      <span className="text-muted-foreground">{p.owner}.</span>
                      {p.prop}
                    </>
                  }
                  meta={p.meta}
                />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {index.modules.length > 0 && (
          <Command.Group heading="Modules">
            {index.modules.map((m) => (
              <Command.Item
                key={`module.${m.path}`}
                value={m.value}
                className={ITEM_CLS}
                onSelect={() => {
                  setSection('schema')
                  if (m.firstClass) {
                    focusClass(`class.${m.firstClass}`)
                    revealOnCanvas(`class.${m.firstClass}`)
                  }
                  close()
                }}
              >
                <Row icon={Folder} label={m.path} meta={m.meta} />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Overviews">
          {OVERVIEWS.map((o) => (
            <Command.Item
              key={`overview.${o.key}`}
              value={`open ${o.label} ${o.key} overview`}
              className={ITEM_CLS}
              onSelect={() => {
                setSection('schema')
                setPanelOverlay(o.key)
                close()
              }}
            >
              <Row icon={o.icon} label={o.label} meta="overview" />
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Go to">
          {SECTIONS.map((s) => (
            <Command.Item
              key={`section.${s.key}`}
              value={`go to ${s.label} ${s.key} section`}
              className={ITEM_CLS}
              onSelect={() => {
                setSection(s.key)
                close()
              }}
            >
              <Row icon={ArrowRight} label={s.label} meta="section" />
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>

      <div className="flex items-center justify-end gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span>↑↓ navigate</span>
        <span>·</span>
        <span>↵ select</span>
        <span>·</span>
        <span>esc close</span>
      </div>
    </Command.Dialog>
  )
}
