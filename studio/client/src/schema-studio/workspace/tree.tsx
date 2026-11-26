import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { Eye, EyeOff } from 'lucide-react'
import { useMemo, useState } from 'react'

import { AnchorButton } from '@/components/anchor'
import { useSchemaDomains } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { OutlineNode } from '../outline/model'
import type { OutlineRow } from '../outline/rows'
import type { WorkspaceDomainProjection } from './projection'

import { DomainRow } from '../domains-rail'
import { buildOutline } from '../outline/model'
import { OutlineLensSwitch, OutlineSkin } from '../outline/skin'
import { type OutlineExpansion, useOutline } from '../outline/use-outline'
import { classRef, edgeRef, isHidden } from '../visibility'
import { useCanvasDomains } from './canvas-selection'
import { useSchemaWorkspace } from './store'

/**
 * One step of the rail's hierarchy, in pixels: enough for a module row's name to clear the
 * domain name above it, which is what makes the two levels read as one tree now that no
 * rule separates them.
 */
const MODULE_INDENT = 18

/** The dot that keeps a selection discoverable when its domain's hierarchy is closed. */
function shouldShowDomainSelectionIndicator({
  holdsSelection,
  closed,
  selected,
}: {
  /** the selection belongs to THIS domain */
  holdsSelection: boolean
  closed: boolean
  selected?: string
}): boolean {
  return holdsSelection && closed && selected !== undefined
}

/**
 * The rail's body: every domain the workspace holds and, under visible unfolded ones,
 * their schema hierarchy. The eye is deliberately the sole canvas visibility control.
 */
export function WorkspaceDomainTree({
  domains,
  onToggleHidden,
}: {
  /** Prepared projections — the visible domains, keyed by id below. */
  domains: WorkspaceDomainProjection[]
  /** Per-member visibility inside one domain (a class or an edge), not the domain itself. */
  onToggleHidden: (domainId: string, ref: string) => void
}) {
  const { data: workspace } = useSchemaDomains()
  const selected = useUI((state) => state.selectedClass)
  const selectionDomainId = useUI((state) => state.selectionDomainId)
  const collapsedByDomain = useSchemaWorkspace((state) => state.collapsedModules)
  const toggleModule = useSchemaWorkspace((state) => state.toggleModule)
  const expandedDomainIds = useSchemaWorkspace((state) => state.expandedDomainIds)
  const toggleDomainExpanded = useSchemaWorkspace((state) => state.toggleDomainExpanded)
  const canvas = useCanvasDomains()
  const expanded = new Set(expandedDomainIds)
  const prepared = new Map(domains.map((domain) => [domain.input.summary.id, domain]))

  const lens = useUI((state) => state.outlineLens)
  const setLens = useUI((state) => state.setOutlineLens)

  return (
    <div data-testid="workspace-domain-tree">
      <OutlineLensSwitch lens={lens} onChange={setLens} className="mx-2 mt-2 mb-1" />
      {(workspace ?? []).map((summary) => {
        const domainId = summary.id
        const domain = prepared.get(domainId)
        const visible = canvas.visible.has(domainId)
        const closed = !visible || !expanded.has(domainId)

        return (
          <section key={domainId}>
            <DomainRow
              origin={summary.origin}
              domainId={domainId}
              visible={visible}
              onToggleVisible={() => canvas.toggleOnCanvas(domainId)}
              {...(visible
                ? {
                    expanded: !closed,
                    onToggleExpanded: () => toggleDomainExpanded(domainId),
                  }
                : {})}
              readOnly={summary.readOnly}
              showSelectionIndicator={shouldShowDomainSelectionIndicator({
                holdsSelection: selectionDomainId === domainId,
                closed,
                selected,
              })}
            />
            {/* No rule and no tint between a domain and its modules: the rail is ONE tree,
                and the hierarchy is carried by the indent alone. */}
            {!closed && domain && (
              <DomainOutline
                domainId={domainId}
                bundle={domain.input.bundle}
                schemaDir={summary.schemaDir}
                hidden={domain.input.visibility.hidden}
                selected={selectionDomainId === domainId ? selected : undefined}
                collapsedModules={collapsedByDomain[domainId] ?? []}
                toggleModule={(path) => toggleModule(domainId, path)}
                toggleHidden={(ref) => onToggleHidden(domainId, ref)}
              />
            )}
          </section>
        )
      })}
    </div>
  )
}

const MODULE_TARGET = 'module.'

/** The comment anchor of a declaration's home row, as the module tree named them. */
function anchorOf(node: OutlineNode): string | undefined {
  if (node.reference) return undefined
  switch (node.kind) {
    case 'module':
    case 'view':
      return node.target
    // a method opens its Class, whose anchor is not the method's
    case 'function':
      return node.target?.startsWith('function.') ? node.target : undefined
    case 'class':
      return classRef(node.label)
    case 'link':
      return edgeRef(node.label)
    default:
      return undefined
  }
}

/** The text a comment quotes from its row: a module's path, else the declaration. */
function excerptOf(node: OutlineNode): string {
  return node.kind === 'module' && node.target
    ? node.target.slice(MODULE_TARGET.length)
    : `${node.kind} ${node.label}`
}

/**
 * One Domain's outline in the rail. A module's fold is the canvas's too, so it lives in
 * the workspace store; every other fold is the rail's own.
 */
function DomainOutline({
  domainId,
  bundle,
  schemaDir,
  hidden,
  selected,
  collapsedModules,
  toggleModule,
  toggleHidden,
}: {
  domainId: string
  bundle: StudioSchemaBundle
  schemaDir?: string
  hidden: Record<string, true>
  selected?: string
  collapsedModules: string[]
  toggleModule: (path: string) => void
  toggleHidden: (ref: string) => void
}) {
  const lens = useUI((state) => state.outlineLens)
  const nodes = useMemo(
    () => buildOutline({ bundle, lens, ...(schemaDir ? { schemaDir } : {}) }),
    [bundle, lens, schemaDir],
  )
  // Module rows by id, to their path: the folds the canvas shares.
  const modules = useMemo(
    () =>
      new Map(
        nodes.flatMap((node) =>
          node.kind === 'module' && node.target
            ? [[node.id, node.target.slice(MODULE_TARGET.length)] as const]
            : [],
        ),
      ),
    [nodes],
  )
  const [folds, setFolds] = useState<OutlineExpansion>({})
  const expansion = useMemo(() => {
    const collapsed = new Set(collapsedModules)
    return {
      ...folds,
      ...Object.fromEntries([...modules].map(([id, path]) => [id, !collapsed.has(path)])),
    }
  }, [folds, modules, collapsedModules])
  const outline = useOutline({
    nodes,
    expansion,
    onExpansionChange: (next) => {
      const own: Record<string, boolean> = {}
      for (const [id, open] of Object.entries(next)) {
        const module = modules.get(id)
        if (module === undefined) own[id] = open
        else if (open === collapsedModules.includes(module)) toggleModule(module)
      }
      setFolds(own)
    },
    selected,
    onSelect: (node) => {
      if (node.target) useUI.getState().selectClass(node.target, domainId)
    },
  })

  // the canvas member a home class or link row shows and hides
  const canvasRefOf = (node: OutlineRow['node']) => {
    if (node.reference) return undefined
    if (node.kind === 'class') return classRef(node.label)
    if (node.kind === 'link') return edgeRef(node.label)
    return undefined
  }

  const trailing = ({ node }: OutlineRow) => {
    const anchor = anchorOf(node)
    const comments = anchor && (
      <AnchorButton
        domainId={domainId}
        anchorRef={{
          ref: anchor,
          kind: node.kind === 'module' || node.kind === 'view' ? 'section' : 'schema',
        }}
        excerpt={excerptOf(node)}
        className="ml-1"
      />
    )
    const ref = canvasRefOf(node)
    if (!ref) return comments
    const off = isHidden(ref, hidden)
    const eye = (
      <button
        type="button"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
          toggleHidden(ref)
        }}
        title={off ? 'Show in canvas' : 'Hide in canvas'}
        className={cn(
          'shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground',
          off ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        {off ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    )
    return (
      <>
        {eye}
        {comments}
      </>
    )
  }

  return (
    <OutlineSkin
      outline={outline}
      indent={MODULE_INDENT}
      trailing={trailing}
      rowAttributes={({ node }) => {
        const anchor = anchorOf(node)
        const ref = canvasRefOf(node)
        return {
          ...(anchor ? { 'data-anchor-ref': anchor, 'data-anchor-excerpt': excerptOf(node) } : {}),
          ...(ref && isHidden(ref, hidden) ? { 'data-hidden': '' } : {}),
        }
      }}
      aria-label={`${bundle.ir?.domain ?? domainId} outline`}
      data-domain-id={domainId}
    />
  )
}
