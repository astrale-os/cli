/**
 * Views lens: what people see. Every View the Domain declares is a card: its name, what it
 * says of itself, how it is built (a single-page app, inline HTML), where it mounts, whether
 * the Domain opens it first, and where its sources do not back it.
 *
 * - The entrypoint leads, then the Views in the order the Schema declares them.
 * - Views declared in more than one module are framed by module, as Behavior frames functions;
 *   all in one, they stand unframed.
 * - A Publication's Views are its Schema's declarations: no code comes with a published
 *   bundle, so each card says so and none is backed or broken.
 * - A route of the Domain's client that no View mounts is not a View: the canvas counts it,
 *   named, instead of drawing it.
 * - Where the sources say what a View's code reaches (`ViewInfo.reach`), the canvas reads in
 *   three bands, as Behavior does: the Views, the functions their code calls, each a step
 *   between a View and the graph, and the Classes. A View links to each function it calls; a
 *   function links to each Class it changes, by verb, as Behavior draws it. Every function and
 *   Class keeps its Behavior id, so a selection carries across lenses, and lighting a View
 *   lights through its functions to what they change.
 *
 * Options:
 * - `reads` also draws each Class a View's code reads, dashed.
 * - A View whose code the reading cannot tell in full says so on its card ("can't tell").
 *
 * Read from the Schema (each View, its entrypoint, where it is declared), from what the
 * Domain's sources say of its code (`DomainAnatomy.views`): how each View is built and mounted,
 * and what it reaches, and from the source overlay for what each function changes.
 */

import type {
  DomainAnatomy,
  StudioSchemaBundle,
  ViewReach,
  ViewReachRead,
} from '@shared/contracts/schema'
import type { InstanceInfo } from '@shared/contracts/workspace'

import { publicationOf } from '@shared/contracts/versions'
import { type IrClassRef, parseClassRefKey } from '@shared/schema/identity'

import { buildViewsModel, type ViewModel, viewAnchor } from '../../lib/views'
import { isKernelClass, resolveClass } from '../../schema-studio/inheritance'
import { moduleHues, moduleLabel, moduleOfMember } from '../../schema-studio/modules'
import {
  type LensOption,
  type LensOptions,
  listed,
  type Scene,
  type SceneBadge,
  type SceneBand,
  type SceneEntry,
  type SceneGroup,
  type SceneLink,
  type SceneNode,
} from '../scene/types'
import { behaviorModel, type FunctionModel, VERB_WORDS } from './behavior'
import { classTarget, originShort } from './structure'

const SCHEMA_DIR = 'schema'

export const VIEWS_OPTIONS: LensOption[] = [
  {
    id: 'reads',
    label: 'Reads',
    description: 'Also draw the Classes each View reads, dashed',
    default: false,
    icon: 'reads',
  },
]

/** The columns the canvas reads in, left to right, where it draws what Views reach. */
const COLUMN = { views: 0, functions: 1, graph: 2 } as const

/** The bands' headings: what each column holds. */
const BANDS: SceneBand[] = [
  { column: COLUMN.views, label: 'Views' },
  { column: COLUMN.functions, label: 'Functions' },
  { column: COLUMN.graph, label: 'Graph' },
]

/** The Index's groups for what Views reach, after the Views. */
const INDEX_VIEWS = 'index.views'
const INDEX_FUNCTIONS = 'index.functions'
const INDEX_GRAPH = 'index.graph'

/** How a View is built, in words; nothing for a View whose code the reading did not find. */
export const VIEW_KIND: Record<ViewModel['kind'], string | undefined> = {
  spa: 'single-page app',
  'inline-html': 'inline HTML',
  unknown: undefined,
}

/** What a View the Schema declares and no code serves reaches: nothing. */
const NO_CODE_REACH: ViewReach = {
  status: 'none',
  reason: 'The Studio found no code serving this View in the Domain’s sources.',
}

/** What a Publication's View reaches, as far as its bundle says: no code comes with it. */
const PUBLISHED_REACH: ViewReach = {
  status: 'none',
  reason: 'A published bundle holds its Schema alone: no View code comes with it.',
}

/** One View as the lens and the Inspector read it. */
export interface ViewFacts extends ViewModel {
  /** the selection target and comment anchor: `view.<slug>` */
  id: string
  /** the Domain opens it by default */
  entrypoint: boolean
  /** where the Schema declares it */
  declared?: { file: string; line: number }
  /** the module its declaration lives in; `root` outside any */
  module: string
  /** declared by a Publication, whose bundle holds no View code */
  published: boolean
}

/** The View the Schema names as its entrypoint, when it names one of its own. */
export function entrypointOf(bundle: StudioSchemaBundle): string | undefined {
  const root = bundle.schemaRoot
  if (typeof root !== 'object' || root === null || !('entrypoint' in root)) return undefined
  const entry = root.entrypoint
  if (typeof entry !== 'object' || entry === null) return undefined
  const { origin, kind, name } = entry as Record<string, unknown>
  return kind === 'view' && origin === bundle.ir?.domain && typeof name === 'string'
    ? name
    : undefined
}

/**
 * Every View the Domain declares, the entrypoint first, then in the Schema's order, then any its
 * sources serve that the Schema does not declare. A View the Schema declares and the sources do
 * not list is still one: its code is not found.
 */
export function viewsOf(bundle: StudioSchemaBundle, anatomy?: DomainAnatomy): ViewFacts[] {
  const published = publicationOf(bundle.domainId) !== undefined
  const entrypoint = entrypointOf(bundle)
  const read = buildViewsModel(anatomy, bundle).all
  const declared = Object.keys(bundle.ir?.views ?? {})
  const bySlug = new Map(read.map((view) => [view.slug, view]))
  const models: ViewModel[] = [
    ...declared.map(
      (slug): ViewModel =>
        bySlug.get(slug) ?? {
          slug,
          kind: 'unknown',
          ...(bundle.ir?.views[slug]?.description === undefined
            ? {}
            : { description: bundle.ir.views[slug]!.description }),
          drift: 'ok',
          reach: published ? PUBLISHED_REACH : NO_CODE_REACH,
        },
    ),
    ...read.filter((view) => !declared.includes(view.slug)),
  ]
  const views = models.map((view): ViewFacts => {
    const span = bundle.overlay.sourceSpans[viewAnchor(view.slug)]
    return {
      ...view,
      id: viewAnchor(view.slug),
      entrypoint: view.slug === entrypoint,
      ...(span ? { declared: { file: span.file, line: span.startLine } } : {}),
      module: moduleOfMember(bundle, 'view', view.slug, SCHEMA_DIR),
      published,
    }
  })
  return [...views.filter((view) => view.entrypoint), ...views.filter((view) => !view.entrypoint)]
}

/** Where a View is reached once open: its mount, else the host it is served from. */
export function viewPlace(view: Pick<ViewModel, 'mount' | 'url'>): string | undefined {
  if (view.mount !== undefined) return view.mount
  if (view.url === undefined) return undefined
  try {
    return new URL(view.url).host
  } catch {
    return view.url
  }
}

/**
 * Why a View cannot be opened, in one sentence; nothing when it can. A View opens on the active
 * instance, which its user must own; a published bundle holds no View code to open.
 * `ownerWarning` is the Studio's sentence for an active instance its user does not own.
 */
export function openBlocker(
  view: Pick<ViewFacts, 'published'>,
  instances: readonly InstanceInfo[] | undefined,
  ownerWarning: string | null,
): string | undefined {
  if (view.published) return 'A published bundle holds no View code, so it cannot open here.'
  if (instances === undefined) return 'Reading the instances…'
  if (!instances.some((instance) => instance.active))
    return 'Choose an instance you own in the header to open it.'
  return ownerWarning ?? undefined
}

/** What a View's code can reach: a Class it reads, a function it calls, a definition it uses. */
export type Reachable =
  | { kind: 'class'; origin: string; name: string }
  | { kind: 'function'; key: string }
  | { kind: 'definition'; definition: 'query' | 'mutation'; id: string }

/** How one View reaches a thing, as read from its code. */
export interface ViewReaching {
  view: ViewFacts
  how: 'calls' | 'reads' | 'uses'
  /** the facts are the frontend's it shares with other Views, not decidably its own */
  shared: boolean
}

/**
 * The Views whose code reaches `what`, and those whose code could not be read in full, so a
 * View missing from `reaching` is known not to reach it only when `untold` is empty.
 */
export function viewsReaching(
  views: readonly ViewFacts[],
  what: Reachable,
  domain: string,
): { reaching: ViewReaching[]; untold: ViewFacts[] } {
  const reaching: ViewReaching[] = []
  const untold: ViewFacts[] = []
  for (const view of views) {
    const reach = view.reach
    if (view.published || reach?.status === 'none') continue
    if (reach === undefined || reach.status === 'unread') {
      untold.push(view)
      continue
    }
    const how =
      what.kind === 'function'
        ? reach.calls.some((call) => call.key === what.key) && 'calls'
        : what.kind === 'class'
          ? reach.reads.some((read) => {
              const ref = classOfRead(read.class, domain)
              return ref.origin === what.origin && ref.name === what.name
            }) && 'reads'
          : reach.definitions.some((use) => use.kind === what.definition && use.id === what.id) &&
            'uses'
    if (how) reaching.push({ view, how, shared: reach.scope === 'frontend' })
    else if (reach.gaps.length > 0) untold.push(view)
  }
  return { reaching, untold }
}

/** The Class a reading names, by the IR's key: a local name, or an imported Class's exact key. */
export function classOfRead(key: string, domain: string): IrClassRef {
  return parseClassRefKey(key) ?? { kind: 'class', origin: domain, name: key }
}

function badgesOf(view: ViewFacts): SceneBadge[] {
  const kind = VIEW_KIND[view.kind]
  return [
    ...(view.entrypoint
      ? [{ label: 'entrypoint', tone: 'view' as const, title: 'The View this Domain opens first' }]
      : []),
    ...(kind ? [{ label: kind, tone: 'muted' as const }] : []),
    ...(view.published
      ? [
          {
            label: 'declared only',
            tone: 'muted' as const,
            outline: true,
            title: 'A published bundle holds its Schema alone: no View code comes with it',
          },
        ]
      : view.kind === 'unknown'
        ? [
            {
              label: 'no code found',
              tone: 'muted' as const,
              outline: true,
              title: 'The Studio found no code serving this View in the Domain’s sources',
            },
          ]
        : []),
    ...(view.drift === 'missing-impl'
      ? [
          {
            label: 'no client route',
            tone: 'warning' as const,
            title: `It mounts at ${view.mount}, which no route of the client serves`,
          },
        ]
      : []),
    ...untoldBadge(view),
  ]
}

/** Where the reading of a View's code cannot tell what it reaches, the card says so. */
function untoldBadge({ reach, published }: ViewFacts): SceneBadge[] {
  if (published || reach === undefined || reach.status === 'none') return []
  const why =
    reach.status === 'unread'
      ? [reach.reason]
      : reach.gaps.map((gap) => `${gap.file}:${gap.line}: ${gap.reason}`)
  return why.length === 0 ? [] : [{ label: 'can’t tell', tone: 'warning', title: why.join('\n') }]
}

function cardOf(view: ViewFacts, framed: boolean, ranked: boolean): SceneNode {
  const place = viewPlace(view)
  const kind = VIEW_KIND[view.kind]
  return {
    id: view.id,
    kind: 'view',
    shape: 'card',
    ...(ranked ? { column: COLUMN.views } : {}),
    label: view.slug,
    ...(place === undefined ? {} : { sublabel: place }),
    ...(framed ? { group: `module.${view.module}` } : {}),
    icon: { glyph: 'view' },
    tone: 'view',
    badges: badgesOf(view),
    ...(view.description === undefined ? {} : { note: view.description }),
    keywords: [
      ...(view.description === undefined ? [] : [view.description]),
      ...(kind === undefined ? [] : [kind]),
      ...(view.entrypoint ? ['entrypoint'] : []),
      ...(view.url === undefined ? [] : [view.url]),
    ],
  }
}

/** The code-read facts of a View, when the reading read it: a Publication's never are. */
const readOf = (view: ViewFacts): ViewReachRead | undefined =>
  !view.published && view.reach?.status === 'read' ? view.reach : undefined

/** What the Views' code reaches, as nodes and links beside the View cards. */
interface Reached {
  nodes: SceneNode[]
  links: SceneLink[]
  /** a fingerprint of the facts drawn, for the Scene key */
  key: string
}

/**
 * The functions the Views' code calls and the Classes it reads, and what each of those
 * functions changes, as Behavior reads it; nothing when no View's code reaches anything.
 * A call to a function the Schema does not declare, and a read of a Class it does not hold as a
 * node, are left to the View's page, which names them.
 */
function reachedBy(
  bundle: StudioSchemaBundle,
  views: readonly ViewFacts[],
  showReads: boolean,
): Reached | undefined {
  const reading = views.flatMap((view) => {
    const reach = readOf(view)
    return reach && (reach.calls.length > 0 || (showReads && reach.reads.length > 0))
      ? [{ view, reach }]
      : []
  })
  if (reading.length === 0 || !bundle.ir) return undefined
  const domain = bundle.ir.domain
  const model = behaviorModel(bundle)
  const byKey = new Map(model.functions.map((fn) => [fn.key, fn]))
  const called = new Map<string, FunctionModel>()
  const classes = new Map<string, IrClassRef>()
  const links = new Map<string, SceneLink>()
  const add = (link: SceneLink) => links.set(link.id, link)

  for (const { view, reach } of reading) {
    const shared = reach.scope === 'frontend' ? { marks: ['shared frontend'] } : {}
    for (const call of reach.calls) {
      const fn = byKey.get(call.key)
      if (!fn) continue
      called.set(fn.id, fn)
      add({
        id: `calls:${view.id}:${fn.id}`,
        opens: fn.id,
        kind: 'call',
        label: 'calls',
        from: { nodes: [view.id] },
        to: { nodes: [fn.id] },
        directed: true,
        tone: 'call',
        ...shared,
      })
    }
    for (const read of showReads ? reach.reads : []) {
      const ref = classOfRead(read.class, domain)
      if (resolveClass(bundle, ref)?.type !== 'node') continue
      const target = classTarget(ref, domain)
      classes.set(target, ref)
      add({
        id: `read:${view.id}:${target}`,
        opens: view.id,
        kind: 'read',
        label: 'reads',
        from: { nodes: [view.id] },
        to: { nodes: [target] },
        directed: true,
        tone: 'muted',
        dashed: true,
        ...shared,
      })
    }
  }

  for (const fn of called.values())
    for (const id of fn.mutations)
      for (const change of model.mutations.get(id)?.changes ?? []) {
        for (const node of change.nodes) {
          const ref = model.classes.get(node)
          if (ref) classes.set(node, ref)
        }
        add({
          id: `change:${fn.id}:${change.verb}:${change.nodes.join(',')}`,
          opens: fn.id,
          kind: 'change',
          label: VERB_WORDS[change.verb],
          from: { nodes: [fn.id] },
          to: { nodes: change.nodes.filter((node) => model.classes.has(node)) },
          directed: true,
          tone: change.verb,
        })
      }

  const functions = [...called.values()].sort((left, right) => left.key.localeCompare(right.key))
  const graph = [...classes].sort(
    ([leftId, left], [rightId, right]) =>
      Number(left.origin !== domain) - Number(right.origin !== domain) ||
      leftId.localeCompare(rightId),
  )
  const nodes: SceneNode[] = [
    ...functions.map((fn): SceneNode => ({
      id: fn.id,
      ...(fn.owner ? { anchor: `class.${fn.owner}.method.${fn.label}` } : {}),
      kind: 'function',
      shape: 'pill',
      column: COLUMN.functions,
      label: fn.label,
      ...(fn.owner ? { sublabel: fn.owner } : {}),
      icon: { glyph: 'function' },
      tone: 'fn',
      ...(fn.owner ? { keywords: [fn.owner] } : {}),
    })),
    ...graph.map(([id, ref]): SceneNode => {
      const home = ref.origin === domain
      const member = resolveClass(bundle, ref)
      return {
        id,
        kind: home ? 'class' : isKernelClass(ref) ? 'kernel class' : 'imported class',
        shape: 'card',
        column: COLUMN.graph,
        label: ref.name,
        ...(home ? {} : { sublabel: originShort(ref.origin) }),
        icon: { ...(member?.icon ? { svg: member.icon } : {}), glyph: 'class' },
        tone: home ? 'node' : 'muted',
      }
    }),
  ]
  const drawn = [...links.values()].filter((link) => link.to.nodes.length > 0)
  return { nodes, links: drawn, key: drawn.map((link) => link.id).join('|') }
}

/**
 * What the Index lists where the canvas draws what Views reach: the Views, framed as on the
 * canvas, then the functions they call and the Classes they reach, as the bands read.
 */
function reachIndex(
  nodes: readonly SceneNode[],
  groups: readonly SceneGroup[],
): NonNullable<Scene['index']> {
  const entry = (node: SceneNode, group: string): SceneEntry => ({
    id: node.id,
    ...(node.anchor ? { anchor: node.anchor } : {}),
    kind: node.kind,
    label: node.label,
    ...(node.sublabel ? { sublabel: node.sublabel } : {}),
    group,
    ...(node.tone ? { tone: node.tone } : {}),
    ...(node.icon ? { icon: node.icon } : {}),
    ...(node.keywords ? { keywords: node.keywords } : {}),
  })
  return {
    groups: [
      ...(groups.length > 0 ? groups : [{ id: INDEX_VIEWS, label: 'Views' }]),
      { id: INDEX_FUNCTIONS, label: 'Functions' },
      { id: INDEX_GRAPH, label: 'Graph' },
    ],
    entries: nodes.map((node) =>
      entry(
        node,
        node.kind === 'view'
          ? (node.group ?? INDEX_VIEWS)
          : node.kind === 'function'
            ? INDEX_FUNCTIONS
            : INDEX_GRAPH,
      ),
    ),
  }
}

export function projectViews(
  bundle: StudioSchemaBundle,
  options: LensOptions,
  _focus?: string,
  anatomy?: DomainAnatomy,
): Scene {
  const views = bundle.ir ? viewsOf(bundle, anatomy) : []
  const modules = [...new Set(views.map((view) => view.module))]
  const framed = modules.length > 1
  const hues = moduleHues(bundle, SCHEMA_DIR)
  const groups: SceneGroup[] = framed
    ? modules.map((module) => {
        const count = views.filter((view) => view.module === module).length
        return {
          id: `module.${module}`,
          label: moduleLabel(module, SCHEMA_DIR),
          ...(hues.has(module) ? { hue: hues.get(module)! } : {}),
          caption: `${count} ${count === 1 ? 'View' : 'Views'}`,
        }
      })
    : []
  const published = publicationOf(bundle.domainId) !== undefined
  const { orphanRoutes } = buildViewsModel(anatomy, bundle)
  const showReads = options.reads === true
  const reached = reachedBy(bundle, views, showReads)
  const nodes = [
    ...views.map((view) => cardOf(view, framed, reached !== undefined)),
    ...(reached?.nodes ?? []),
  ]
  return {
    key: [
      'views',
      bundle.domainId,
      bundle.renderFingerprint,
      JSON.stringify(
        views.map(({ slug, kind, mount, url, drift, reach }) => [
          slug,
          kind,
          mount,
          url,
          drift,
          reach?.status === 'read' ? reach.gaps.length : (reach?.status ?? ''),
        ]),
      ),
      orphanRoutes.join(','),
      showReads ? 'reads' : '',
      reached?.key ?? '',
    ].join(':'),
    nodes,
    links: reached?.links ?? [],
    groups,
    ...(reached
      ? { trunkLabel: 'labels', lines: 'ribbons', bands: BANDS, index: reachIndex(nodes, groups) }
      : {}),
    folded:
      orphanRoutes.length === 0
        ? []
        : [
            {
              label:
                orphanRoutes.length === 1
                  ? 'Client route without a View'
                  : 'Client routes without a View',
              count: orphanRoutes.length,
              reason: `no View mounts ${listed(orphanRoutes)}`,
            },
          ],
    ...(views.length === 0
      ? {
          empty: published
            ? 'The published Schema declares no View.'
            : 'This Domain declares no View: nothing here is shown to people.',
        }
      : {}),
  }
}
