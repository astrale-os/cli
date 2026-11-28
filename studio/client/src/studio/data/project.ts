/**
 * The dataset as a map: a pure projection of one dataset's model into a Scene the Studio's canvas
 * draws. Each Class is a region in its Schema-level hue, each Node a card in it, each Edge a
 * link. What would crowd the map is gathered, and every gathering says what it holds:
 *
 * - A collapsed region is one box: its Nodes stay in the Scene (the box counts them), and the
 *   Edges inside it are counted on it.
 * - An open region draws at most `REGION_BOUND` Nodes, plus the ones in focus; the rest stand
 *   behind one card that counts them, and the Scene's folds say so.
 * - Edges whose ends are not both drawn as their own cards travel as one link per relationship
 *   and pair of ends, counted (`deployment_of ×1500`); the canvas bundles the links between two
 *   boxes into one trunk.
 *
 * Through the Rules lens, a complete read summary marks each Node can read, can't read or
 * can't tell, and counts each region's readable Nodes in its label. Through the Behavior lens the
 * map is the dataset as written, as in Structure; a step selected marks who acts and how (reads,
 * traverses or calls), and marks each region its function is declared to write with the verbs,
 * outlined: declared, never applied. A declared Class no Node of the dataset is of stands as a
 * quiet card of its own, so its mark has a place.
 */

import type { ScenarioStep } from '@shared/contracts/scenarios'

import type { ChangeVerb } from '../lenses/behavior'
import type {
  Scene,
  SceneBadge,
  SceneFold,
  SceneGroup,
  SceneLink,
  SceneNode,
  SceneRow,
} from '../scene/types'
import type { Outcome, Reads } from './access'
import type { JudgedStep } from './scenarios'

import { withArticle } from '../inspector/words'
import { COLLAPSE_ABOVE } from '../scene/arrange'
import { OUTCOME_MARKS } from './marks'
import {
  type DataClass,
  type DatasetModel,
  classLabel,
  indexOfEdgeId,
  nodeId,
  outsideId,
} from './model'

/** How many Nodes an open region draws as their own cards before the rest stand behind one. */
export const REGION_BOUND = 40
/** How many property rows a card reads when near; the rest are counted. */
const ROWS_SHOWN = 6

export type DataLens = 'structure' | 'behavior' | 'rules'

/** A write a function is declared to make: its verb and the Behavior lens's word for it. */
export interface DeclaredVerb {
  readonly verb: ChangeVerb
  readonly word: string
}

/** What a Behavior step selected marks on the map. */
export interface StepMarks {
  /** the identity it acts as, by path */
  readonly actor?: string
  /** what it does */
  readonly does: ScenarioStep['does']
  /** the function it calls, for a call */
  readonly fn?: string
  /** what its function is declared to write, by region, in the Behavior lens's order */
  readonly declared: ReadonlyMap<string, readonly DeclaredVerb[]>
  /** the declared Classes no Node of the dataset is of, by target: their names and verbs */
  readonly absent: ReadonlyMap<
    string,
    { readonly name: string; readonly verbs: readonly DeclaredVerb[] }
  >
}

/** What a step selected marks: who acts and how, and where its declared writes would land. */
export function stepMarksOf(judged: JudgedStep): StepMarks {
  const declared = new Map<string, DeclaredVerb[]>()
  const absent = new Map<string, { name: string; verbs: DeclaredVerb[] }>()
  const add = (verbs: DeclaredVerb[], change: DeclaredVerb) => {
    if (!verbs.some((one) => one.verb === change.verb))
      verbs.push({ verb: change.verb, word: change.word })
  }
  for (const change of judged.declared?.changes ?? []) {
    for (const region of change.regions) {
      const verbs = declared.get(region) ?? []
      add(verbs, change)
      declared.set(region, verbs)
    }
    for (const cls of change.absent) {
      const held = absent.get(cls.target) ?? { name: cls.name, verbs: [] }
      add(held.verbs, change)
      absent.set(cls.target, held)
    }
  }
  const { step } = judged
  return {
    ...(judged.facts.actor ? { actor: judged.facts.actor } : {}),
    does: step.does,
    ...(step.does === 'call' ? { fn: step.fn } : {}),
    declared,
    absent,
  }
}

/** The quiet card a declared Class no Node of the dataset is of stands as. */
export const absentId = (target: string) => `absent.${target}`

/** How an actor's mark says what it does, in the hue the Schema's rules give each operation. */
const ACTS: Record<ScenarioStep['does'], { label: string; tone: SceneBadge['tone'] }> = {
  read: { label: 'reads', tone: 'read' },
  traverse: { label: 'traverses', tone: 'traverse' },
  call: { label: 'calls', tone: 'call' },
}

function actorBadge(step: StepMarks): SceneBadge {
  const act = ACTS[step.does]
  return {
    ...act,
    title:
      step.fn === undefined
        ? `In the step selected, this identity ${act.label}.`
        : `In the step selected, this identity calls ${step.fn}.`,
  }
}

/** A region's or a stand-in's marks: what the step's function is declared to write there. */
function declaredBadges(
  verbs: readonly DeclaredVerb[] | undefined,
  step: StepMarks,
  where: string,
): SceneBadge[] {
  if (!verbs || verbs.length === 0) return []
  const title = `${step.fn ?? 'Its function'} is declared to ${verbs
    .map((one) => one.word)
    .join(', ')} ${where}; nothing is applied to the dataset.`
  return [
    { label: 'declared', tone: 'muted', outline: true, title },
    ...verbs.map((one) => ({ label: one.word, tone: one.verb, outline: true, title })),
  ]
}

export interface DataSceneInput {
  readonly lens: DataLens
  /** the regions drawn as one box */
  readonly collapsed: ReadonlySet<string>
  /** Node paths drawn as their own cards whatever the bound: the selection and what it reaches */
  readonly focus?: readonly string[]
  /** the paths of the dataset's identities */
  readonly identities?: ReadonlySet<string>
  /** the identity the Rules lens reads as: a Node's path, or the anyone choice */
  readonly as?: string
  /** what `as` may read, once every Node is decided */
  readonly reads?: Reads
  /** through Behavior: what the step selected marks */
  readonly step?: StepMarks
}

export interface DataScene {
  readonly scene: Scene
  /** every Node and end as the Index lists them, whatever the map draws */
  readonly index: Scene
  /** each link's Edges, by their place in the dataset */
  readonly edgesOf: ReadonlyMap<string, readonly number[]>
  /** the link that carries each Edge, by its place in the dataset */
  readonly linkOf: ReadonlyMap<number, string>
  /** the card a Node not drawn stands behind, by path */
  readonly behind: ReadonlyMap<string, string>
  /** the Nodes each stand-in card holds, by its id */
  readonly held: ReadonlyMap<string, readonly string[]>
  /** the scene id that draws a Node or end, by path: its card, its stand-in, or its region's box */
  readonly drawnAs: (path: string) => string | undefined
}

/** The stand-in card of an open region above the bound. */
export const standInId = (target: string) => `more.${target}`
export const isStandIn = (id: string) => id.startsWith('more.')
export const regionOfStandIn = (id: string) => id.slice('more.'.length)
/** An aggregated link's id: one relationship between two ends that are not both cards. */
export const isGathered = (id: string) => id.startsWith('edges.')

/** The regions a dataset opens with collapsed: all of them once it is too large to read whole. */
export function regionsAtRest(model: DatasetModel): Set<string> {
  if (model.order.length <= COLLAPSE_ABOVE || model.classes.length < 2) return new Set()
  return new Set(model.classes.map((cls) => cls.target))
}

const fingerprints = new WeakMap<DatasetModel, string>()

/** What the dataset holds, hashed: equal fingerprints, equal Nodes, Classes and Edges. */
function fingerprintOf(model: DatasetModel): string {
  const known = fingerprints.get(model)
  if (known) return known
  let hash = 0x811c9dc5
  const mix = (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  for (const node of model.order)
    mix(`${node.path}\u0000${node.classTarget}\u0000${node.label}\u0001`)
  for (const edge of model.edges) mix(`${edge.from}\u0000${edge.name}\u0000${edge.to}\u0001`)
  const found = `${model.dataset.revision}:${(hash >>> 0).toString(36)}:${model.order.length}:${model.edges.length}`
  fingerprints.set(model, found)
  return found
}

/** Whether the identity picked may read a Node, in the tone of the verdict's outcome. */
const READ_BADGE: Record<Outcome, SceneBadge> = {
  allowed: {
    label: 'can read',
    tone: OUTCOME_MARKS.allowed.tone,
    title: 'This identity may read this Node.',
  },
  refused: {
    label: "can't read",
    tone: OUTCOME_MARKS.refused.tone,
    title: 'This identity may not read this Node.',
  },
  unknown: {
    label: "can't tell",
    tone: OUTCOME_MARKS.unknown.tone,
    title: 'The rules cannot be decided for this Node on this dataset; select it for the reason.',
  },
}

/**
 * A region's label: its Class, and in Rules, while it is open, how many of its Nodes the identity
 * reads. A collapsed region keeps its Class alone, so its box keeps its size once the reads are
 * decided; the identity picker counts every region.
 */
function regionLabel(cls: DataClass, input: DataSceneInput): string {
  const reads =
    input.lens === 'rules'
      ? input.reads?.classes.find((one) => one.target === cls.target)
      : undefined
  if (!reads || input.reads?.pending || input.collapsed.has(cls.target)) return classLabel(cls)
  return `${classLabel(cls)} · ${reads.allowed} of ${reads.total} readable`
}

export function projectData(model: DatasetModel, input: DataSceneInput): DataScene {
  const rules = input.lens === 'rules' && input.reads !== undefined && input.reads.pending === 0
  const focus = new Set(input.focus ?? [])
  const identities = input.identities ?? new Set<string>()

  // Which Nodes are their own cards: every Node of a collapsed region (the box stands for them
  // all), and in an open region the first `REGION_BOUND` and every one in focus.
  const own = new Set<string>()
  const behind = new Map<string, string>()
  const held = new Map<string, string[]>()
  for (const cls of model.classes) {
    if (input.collapsed.has(cls.target) || cls.nodes.length <= REGION_BOUND + 1) {
      for (const path of cls.nodes) own.add(path)
      continue
    }
    let drawn = 0
    for (const path of cls.nodes) {
      if (drawn < REGION_BOUND || focus.has(path)) {
        own.add(path)
        drawn += 1
        continue
      }
      const standIn = standInId(cls.target)
      behind.set(path, standIn)
      const holding = held.get(standIn)
      if (holding) holding.push(path)
      else held.set(standIn, [path])
    }
  }

  const cardOf = (path: string): string => {
    if (model.outside.has(path)) return outsideId(path)
    return behind.get(path) ?? nodeId(path)
  }
  /** The box a path ends up in once the canvas collapses regions: for gathering Edges. */
  const boxKeyOf = (path: string): string => {
    const cls = model.classOf.get(path)
    if (cls && input.collapsed.has(cls.target)) return cls.target
    return cardOf(path)
  }

  const nodes: SceneNode[] = []
  const groups: SceneGroup[] = []
  const folded: SceneFold[] = []
  const indexNodes: SceneNode[] = []

  const step = input.lens === 'behavior' ? input.step : undefined
  for (const cls of model.classes) {
    const declared = step
      ? declaredBadges(step.declared.get(cls.target), step, `on ${withArticle(cls.name)}`)
      : []
    groups.push({
      id: cls.target,
      label: regionLabel(cls, input),
      ...(cls.hue === undefined ? {} : { hue: cls.hue }),
      ...(declared.length > 0 ? { badges: declared } : {}),
    })
    for (const path of cls.nodes) {
      const node = model.nodes.get(path)!
      const edges =
        (model.outgoing.get(path)?.length ?? 0) + (model.incoming.get(path)?.length ?? 0)
      const rows: SceneRow[] = node.properties
        .filter((line) => line.depth === 0)
        .slice(0, ROWS_SHOWN)
        .map((line) => ({
          id: `${node.id}.property.${line.key}`,
          label: line.label,
          ...(line.value === '' ? {} : { detail: line.value }),
        }))
      const top = node.properties.filter((line) => line.depth === 0).length
      if (top > ROWS_SHOWN)
        rows.push({ id: `${node.id}.property.@more`, label: `${top - ROWS_SHOWN} more properties` })
      const badges: SceneBadge[] = []
      if (step?.actor === path) badges.push(actorBadge(step))
      else if (identities.has(path)) {
        badges.push(
          input.lens === 'rules' && input.as === path
            ? {
                label: 'as this identity',
                tone: 'call',
                title: 'The Rules lens reads the dataset as this identity.',
              }
            : { label: 'identity', title: 'A Node of a Class that is or extends Kernel Identity.' },
        )
      }
      const verdict = rules ? input.reads!.verdicts.get(path) : undefined
      if (verdict) badges.push(READ_BADGE[verdict.outcome])
      if (input.lens !== 'rules')
        for (const name of node.variables)
          badges.push({
            label: name,
            near: true,
            title: `The dataset's variable ${name} names this Node.`,
          })
      const scene: SceneNode = {
        id: node.id,
        kind: 'node',
        shape: 'card',
        label: node.label,
        ...(node.label === path ? {} : { sublabel: path }),
        group: cls.target,
        icon: cls.icon ? { svg: cls.icon } : { glyph: identities.has(path) ? 'identity' : 'class' },
        tone: verdict?.outcome === 'refused' ? 'muted' : cls.local ? 'node' : 'core',
        counts: [
          { label: 'properties', value: top },
          ...(edges > 0 ? [{ label: 'edges', value: edges }] : []),
        ],
        ...(badges.length > 0 ? { badges } : {}),
        ...(rows.length > 0 ? { rows } : {}),
        keywords: [path, cls.name, ...node.variables],
      }
      indexNodes.push(scene)
      if (own.has(path)) nodes.push(scene)
    }
    const standIn = standInId(cls.target)
    const hidden = held.get(standIn)
    if (hidden) {
      const counted = rules
        ? hidden.reduce(
            (sum, path) => sum + (input.reads!.verdicts.get(path)?.outcome === 'allowed' ? 1 : 0),
            0,
          )
        : undefined
      nodes.push({
        id: standIn,
        kind: 'more',
        shape: 'card',
        label: `${hidden.length} more ${cls.name} Nodes`,
        group: cls.target,
        icon: { glyph: 'class' },
        tone: 'muted',
        counts: [{ label: 'nodes', value: hidden.length }],
        ...(counted === undefined
          ? {}
          : {
              badges: [
                {
                  label: `${counted} readable`,
                  tone: counted > 0 ? OUTCOME_MARKS.allowed.tone : 'muted',
                },
              ],
            }),
      })
      folded.push({
        label: `${cls.name} Nodes`,
        count: hidden.length,
        reason: `drawn as one card past ${REGION_BOUND} — select it or the region to list them in the panel`,
      })
    }
  }

  // Regions drawn as one box each say what they gather.
  const gatheredRegions = model.classes.filter((cls) => input.collapsed.has(cls.target))
  if (gatheredRegions.length > 0) {
    const count = gatheredRegions.reduce((sum, cls) => sum + cls.nodes.length, 0)
    folded.push({
      label: 'Nodes in collapsed regions',
      count,
      reason:
        gatheredRegions.length === 1
          ? `gathered in the collapsed region ${classLabel(gatheredRegions[0]!)} — open it to draw them, ${REGION_BOUND} at a time`
          : `gathered in ${gatheredRegions.length} collapsed regions — open one to draw its Nodes, ${REGION_BOUND} at a time`,
    })
  }

  // A declared Class no Node is of: a quiet card of its own, outside every region.
  for (const [target, held] of step?.absent ?? []) {
    nodes.push({
      id: absentId(target),
      kind: 'absent',
      shape: 'card',
      label: held.name,
      sublabel: 'no Node in this dataset',
      icon: { glyph: 'class' },
      tone: 'muted',
      absent: true,
      badges: declaredBadges(held.verbs, step!, `on ${withArticle(held.name)}`),
    })
  }

  for (const end of model.outside.values()) {
    const scene: SceneNode = {
      id: end.id,
      kind: 'endpoint',
      shape: 'card',
      label: end.label,
      ...(end.kind === 'external' ? { sublabel: end.path } : {}),
      icon: { glyph: end.kind === 'domain' ? 'module' : 'class' },
      tone: 'muted',
      keywords: [end.path],
    }
    nodes.push(scene)
    indexNodes.push(scene)
  }

  // Edges: their own link between two cards and inside a collapsed region (where the box counts
  // it); otherwise gathered per relationship and pair of boxes.
  const links: SceneLink[] = []
  const edgesOf = new Map<string, number[]>()
  const linkOf = new Map<number, string>()
  const gathered = new Map<
    string,
    { name: string; group?: string; from: Set<string>; to: Set<string>; edges: number[] }
  >()
  const loops = new Map<string, number>()
  for (const edge of model.edges) {
    const fromCard = cardOf(edge.from)
    const toCard = cardOf(edge.to)
    const fromBox = boxKeyOf(edge.from)
    const toBox = boxKeyOf(edge.to)
    const region = model.classOf.get(edge.from)?.target
    // Its own link between two cards of open regions, or inside one collapsed region.
    const single =
      !isStandIn(fromCard) &&
      !isStandIn(toCard) &&
      ((fromBox === fromCard && toBox === toCard) || fromBox === toBox)
    if (fromCard === toCard && isStandIn(fromCard)) {
      loops.set(fromCard, (loops.get(fromCard) ?? 0) + 1)
      continue
    }
    if (single) {
      links.push({
        id: edge.id,
        kind: 'edge',
        label: edge.name,
        ...(region ? { group: region } : {}),
        from: { nodes: [fromCard] },
        to: { nodes: [toCard] },
        directed: true,
        tone: 'edge',
      })
      edgesOf.set(edge.id, [edge.index])
      linkOf.set(edge.index, edge.id)
      continue
    }
    const key = `${edge.name}|${fromBox}|${toBox}`
    let gathering = gathered.get(key)
    if (!gathering) {
      gathering = {
        name: edge.name,
        ...(region ? { group: region } : {}),
        from: new Set(),
        to: new Set(),
        edges: [],
      }
      gathered.set(key, gathering)
    }
    gathering.from.add(fromCard)
    gathering.to.add(toCard)
    gathering.edges.push(edge.index)
  }
  for (const [key, gathering] of gathered) {
    const [first] = gathering.edges
    const id = gathering.edges.length === 1 ? model.edgeAt.get(first!)!.id : `edges.${key}`
    links.push({
      id,
      kind: 'edge',
      label:
        gathering.edges.length === 1
          ? gathering.name
          : `${gathering.name} ×${gathering.edges.length}`,
      ...(gathering.group ? { group: gathering.group } : {}),
      from: { nodes: [...gathering.from] },
      to: { nodes: [...gathering.to] },
      directed: true,
      tone: 'edge',
    })
    edgesOf.set(id, gathering.edges)
    for (const index of gathering.edges) linkOf.set(index, id)
  }
  for (const node of nodes) {
    const inside = loops.get(node.id)
    if (inside) node.counts = [...(node.counts ?? []), { label: 'edges among them', value: inside }]
  }

  const regionsKey = [...input.collapsed]
    .filter((id) => model.classByTarget.has(id))
    .sort()
    .join(',')
  const key = [
    'data',
    model.origin,
    model.dataset.id,
    fingerprintOf(model),
    input.lens,
    regionsKey,
    [...focus].sort().join(','),
    input.lens === 'rules' ? `${input.as ?? ''}:${rules ? 'read' : 'deciding'}` : '',
    input.lens === 'behavior' ? stepKey(input.step) : '',
  ].join('|')
  const scene: Scene = { key, nodes, links, groups, folded, trunkLabel: 'labels' }
  // The Index names each region by its Class alone: the count is the map's and the picker's.
  const indexGroups = groups.map((group) => {
    const cls = model.classByTarget.get(group.id)
    return cls ? { ...group, label: classLabel(cls) } : group
  })
  const index: Scene = {
    key: `${key}|index`,
    nodes: indexNodes,
    links,
    groups: indexGroups,
    folded: [],
  }
  return {
    scene,
    index,
    edgesOf,
    linkOf,
    behind,
    held,
    drawnAs: (path) => {
      if (model.outside.has(path)) return outsideId(path)
      if (!model.nodes.has(path)) return undefined
      return behind.get(path) ?? nodeId(path)
    },
  }
}

/** Equal keys, equal marks. */
const stepKey = (step: StepMarks | undefined) => {
  if (!step) return ''
  const said = (marks: Iterable<readonly [string, readonly DeclaredVerb[]]>) =>
    [...marks]
      .map(([at, verbs]) => `${at}=${verbs.map((one) => one.verb).join(',')}`)
      .sort()
      .join(';')
  const absent = [...step.absent].map(([target, held]) => [target, held.verbs] as const)
  return [step.actor ?? '', step.does, step.fn ?? '', said(step.declared), said(absent)].join(':')
}

/**
 * What steps light on the map: who acts, what each names and its verdict stands on, the regions
 * its function is declared to write, and the stand-in of each declared Class the dataset holds
 * no Node of.
 */
export function stepsLit(projection: DataScene, steps: readonly JudgedStep[]): string[] {
  const facts = sceneIdsOf(projection, {
    nodes: steps.flatMap((one) => [
      ...one.facts.nodes,
      ...(one.facts.actor ? [one.facts.actor] : []),
    ]),
    edges: steps.flatMap((one) => one.facts.edges),
  })
  const declared = steps.flatMap((one) =>
    (one.declared?.changes ?? []).flatMap((change) => [
      ...change.regions,
      ...change.absent.map((cls) => absentId(cls.target)),
    ]),
  )
  return [...new Set([...facts, ...declared])]
}

/**
 * The scene ids that stand for facts a verdict names: Node paths and Edge ids, each through its
 * own card or link, or what gathers it.
 */
export function sceneIdsOf(
  projection: DataScene,
  facts: { readonly nodes: readonly string[]; readonly edges: readonly string[] },
): string[] {
  const ids = new Set<string>()
  for (const path of facts.nodes) {
    const id = projection.drawnAs(path)
    if (id) ids.add(id)
  }
  for (const edge of facts.edges) {
    const index = indexOfEdgeId(edge)
    const link = index === undefined ? undefined : projection.linkOf.get(index)
    if (link) ids.add(link)
  }
  return [...ids]
}
