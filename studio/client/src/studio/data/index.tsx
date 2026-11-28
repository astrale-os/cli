/**
 * The Data level: one dataset of a Domain on the canvas, read through the same lenses as its
 * Schema. Structure draws each Node as a card in its Class's region and each Edge as a link;
 * Rules reads the dataset as one of its identities, or as anyone, and says per Node and per
 * Edge what that identity may do and by which rule, each verdict pinnable to a Scenario, and
 * lists the Domain's Policies: one selected — or carried from the Schema — lights who it admits
 * to what, pair by pair; Behavior reads the dataset's Scenarios, each step judged again on the dataset as written,
 * and lights what a step selected acts as, acts on, stands on and is declared to write.
 *
 * The map is the Studio's Scene canvas, drawn from a pure projection of the dataset
 * (`projectData`); the Index lists the same Nodes, and the panel reads the selection in
 * sentences. A dataset too large to read whole opens with every region collapsed, and every
 * gathering on the map says what it holds.
 */

import type { Scenario, ScenarioStep } from '@shared/contracts/scenarios'
import type {
  StudioDataset,
  StudioDatasetFailure,
  StudioSchemaBundle,
} from '@shared/contracts/schema'

import { ANYONE } from '@shared/contracts/scenarios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ErrorBanner } from '@/components/error-banner'
import { useBundle, useDatasets } from '@/lib/hooks'
import { useOnScreen } from '@/lib/notices'
import { useUI } from '@/lib/store'

import type { Frame } from '../canvas/frame'
import type { Pins } from '../canvas/pins'
import type { LensKey } from '../lenses/keys'
import type { DomainRules, PolicyRule } from '../rules/model'
import type { OwnWalk } from '../scene/rules'
import type { Scene, SceneEntry, SceneGroup } from '../scene/types'
import type { Decided } from './panel'
import type { Pinning } from './pin'

import { DOCK_CLEARANCE, TOOLBAR_CLEARANCE } from '../../schema-studio/palette'
import { PanelOpener, PanelShell } from '../../schema-studio/panel-shell'
import { GLYPHS } from '../canvas/glyphs'
import { SceneCanvas } from '../canvas/scene-canvas'
import { useCanvas } from '../canvas/store'
import { useLensPins } from '../canvas/use-lens-pins'
import { IndexRail } from '../index-rail/index-rail'
import { originShort } from '../lenses/structure'
import { arrange, arrangementKey } from '../scene/arrange'
import { isolateScene } from '../scene/focus'
import { useStage } from '../stage/store'
import { accessOf, edgeVerdict, edgesOf, nodeVerdicts } from './access'
import { AskLevel } from './ask/ask-level'
import { BarLine, DataBar } from './ask/question-bar'
import { scaled } from './ask/scale'
import { useAsk, useAskView } from './ask/store'
import { BehaviorPanel, StepsInvolving } from './behavior-panel'
import { DatasetLabel } from './dataset-label'
import { IdentityPicker } from './identity-picker'
import {
  type DatasetModel,
  datasetModel,
  datasetLabel,
  datasetName,
  findDataset,
  identityLabel,
  indexOfEdgeId,
  nodeId,
  pathOfNodeId,
} from './model'
import { DataPanel, defaultLit } from './panel'
import { pairCase, pairProof } from './policy-pairs'
import {
  type DataLens,
  isGathered,
  isStandIn,
  projectData,
  regionOfStandIn,
  regionsAtRest,
  sceneIdsOf,
  stepMarksOf,
  stepsLit,
} from './project'
import { nameOf, withStep } from './scenario-edits'
import {
  type JudgedScenario,
  type JudgedStep,
  type Judging,
  askOf,
  edgeRef,
  involves,
  judgeScenario,
  rulesTargetOf,
} from './scenarios'
import { datasetScope, useDataView, useDatasetView } from './store'
import { usePolicyPairs, useReads } from './use-decided'
import { newScenarioId, useScenarios } from './use-scenarios'
import { DataWait } from './wait'
import { walkFactsOf, walkOnMap } from './walk'

/** The Data level with no dataset chosen: the Domain's datasets, each to open. */
export { DatasetsPage } from './datasets-page'

export interface DataLevelProps {
  domainId: string
  /** the Domain's origin, as its wait and the dataset's label name it */
  origin: string
  /** The dataset's module path, as its Domain's config writes it: its name, read or not. */
  datasetPath: string
  lens: LensKey
  /** when the reader asked for the dataset, in epoch milliseconds: its wait's clock */
  since: number
}

/** How many of a selected Node's neighbours are drawn as their own cards, past a region's bound. */
const FOCUS_NEIGHBOURS = 60
/** The verdict choice that lights no proof: the selection's neighbourhood shows instead. */
const NO_VERDICT = '@none'
const NOTHING: ReadonlySet<string> = new Set()
const NO_PINS: Pins = new Map()
/** The Index group of the dataset's Scenarios, through Behavior, and the entry of each. */
const SCENARIOS = 'scenarios'
const SCENARIO_ENTRY = 'scenario.'
/** The Index group of the Domain's Policies, through Rules; each entry is the Policy's selection id. */
const POLICIES = 'policies'
/** A pair of a Policy, lit: `pair:<identity>|<object>`. */
const PAIR = 'pair:'

/** A dataset's arrangement is kept as a lens of its Domain's layout record, one per dataset. */
function pinsLensOf(datasetId: string): string {
  const slug = datasetId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const lens = `data-${slug}`
  if (/^[a-z][a-z0-9-]{0,31}$/.test(lens)) return lens
  let hash = 0x811c9dc5
  for (let index = 0; index < datasetId.length; index++)
    hash = Math.imul(hash ^ datasetId.charCodeAt(index), 0x01000193)
  return `data-${slug.slice(0, 17).replace(/-+$/, '')}-${(hash >>> 0).toString(36)}`
}

export function DataLevel({ domainId, origin, datasetPath, lens, since }: DataLevelProps) {
  const bundle = useBundle(domainId)
  const datasets = useDatasets(domainId)
  const found = datasets.data ? findDataset(datasets.data.datasets, datasetPath) : undefined
  // On screen once it draws the dataset, or says why it cannot; a dataset the address named
  // that is gone is left at once for another, and is no place to say anything.
  const drawn =
    datasets.isError ||
    found?.status === 'failed' ||
    (found?.status === 'ready' && !bundle.isPending)
  useOnScreen(drawn ? { level: 'data', domainId } : undefined)
  const name = datasetName(datasets.data?.datasets, datasetPath)
  // shown, read or not, the dataset is the one last read on its Domain: Data opens it again
  const shown = found !== undefined && found.status !== 'missing'
  const rememberDataset = useUI((state) => state.rememberDataset)
  useEffect(() => {
    if (shown) rememberDataset(domainId, datasetPath)
  }, [datasetPath, domainId, rememberDataset, shown])
  const wait = (reading: string) => <DataWait since={since} dataset={name} reading={reading} />

  let body
  if (datasets.isError)
    body = (
      <Status
        title="The datasets could not be extracted."
        detail={datasets.error instanceof Error ? datasets.error.message : undefined}
      />
    )
  else if (!found) body = wait(`Reading the datasets ${origin} declares`)
  else if (found.status === 'failed') body = <FailedDataset failure={found.failure} />
  else if (found.status === 'missing')
    body = <Status title={`This Domain declares no dataset ${datasetPath}.`} />
  else if (bundle.isPending) body = wait(`Reading the Schema of ${origin}`)
  else if (lens === 'structure' && bundle.data?.ir)
    // Through Structure a dataset is asked, never drawn whole (`ask/ask-level.tsx`).
    return (
      <AskLevel domainId={domainId} origin={origin} dataset={found.dataset} bundle={bundle.data} />
    )
  else
    return (
      <DatasetLevel
        domainId={domainId}
        dataset={found.dataset}
        bundle={bundle.data}
        bundleError={bundle.isError ? bundle.error : undefined}
        lens={lens}
      />
    )
  return (
    <div
      data-testid="data-level"
      data-state={found?.status ?? 'loading'}
      data-dataset-path={datasetPath}
      className="relative h-full w-full"
    >
      {body}
      {/* where the canvas would stand its label: a dataset not drawn is left the same way */}
      <div className="absolute left-3 top-3">
        <DatasetLabel name={name} origin={origin} />
      </div>
    </div>
  )
}

function DatasetLevel({
  domainId,
  dataset,
  bundle,
  bundleError,
  lens,
}: {
  domainId: string
  dataset: StudioDataset
  bundle?: StudioSchemaBundle
  bundleError?: unknown
  lens: LensKey
}) {
  const dataLens: DataLens = lens
  const scope = datasetScope(domainId, dataset.id)
  // The size the dataset is read at is the reader's, the same through every lens (`ask/scale.ts`).
  const factor = useAskView(scope).factor
  const setFactor = useAsk((state) => state.setFactor)
  const openDataLevel = useUI((state) => state.openDataLevel)
  const model = useMemo(
    () => datasetModel(bundle?.ir ? scaled(dataset, bundle, factor) : dataset, bundle),
    [bundle, dataset, factor],
  )
  // Rules decide against one moment: the same verdicts while the dataset is read.
  const [now] = useState(() => new Date().toISOString())
  const decided = useMemo(
    () => (bundle ? accessOf(bundle, model, now) : undefined),
    [bundle, model, now],
  )
  const access = decided && !('status' in decided) ? decided : undefined
  const unread = decided && 'status' in decided ? decided : undefined
  const identities = useMemo(() => new Set(access?.identities.map((one) => one.id)), [access])

  const view = useDatasetView(scope)
  const reveal = useDataView((state) => state.reveal)
  const panelOpen = useDataView((state) => state.panelOpen)
  const select = useDataView((state) => state.select)
  const setIdentity = useDataView((state) => state.setIdentity)
  const lightVerdict = useDataView((state) => state.lightVerdict)
  const openScenario = useDataView((state) => state.openScenario)
  const selectStep = useDataView((state) => state.selectStep)
  const revealed = useDataView((state) => state.revealed)
  const setPanelOpen = useDataView((state) => state.setPanelOpen)

  // The selection is the thread across levels: a dataset opened while a Class is selected on
  // its Schema opens on that Class's Nodes, unless it already holds a selection of its own.
  const schemaSelection = useUI((state) =>
    state.selectionDomainId === domainId ? state.selectedClass : undefined,
  )
  // A Policy carried from the Schema (`carryToDataset`) is the dataset's own selection already.
  const rules = access?.rules
  const seeded = useRef<string | null>(null)
  useEffect(() => {
    if (seeded.current === scope) return
    seeded.current = scope
    if (useDataView.getState().views[scope]?.selected !== undefined) return
    if (schemaSelection && isSelectable(model, schemaSelection, rules))
      select(scope, schemaSelection, true)
  }, [model, rules, schemaSelection, scope, select])

  // The identity chosen, while the dataset still holds it; anyone otherwise.
  const identity =
    view.identity === ANYONE || identities.has(view.identity) ? view.identity : ANYONE
  const selected =
    view.selected && isSelectable(model, view.selected, rules) ? view.selected : undefined
  const selectedPath = selected ? pathOfNodeId(selected) : undefined
  const selectedEdge = selected ? indexOfEdgeId(selected) : undefined
  // A Policy selected: what it admits, pair by pair, and what the map lights of it — the pair
  // lit, else every pair it admits.
  const policy = selected && rules ? policyOf(rules, selected) : undefined
  const pairs = usePolicyPairs(access, policy)
  const admits = useMemo(() => {
    if (!access || !policy || !pairs || pairs.pending > 0) return undefined
    const litPair = view.verdict?.startsWith(PAIR)
      ? pairs.pairs.find((pair) => `${PAIR}${pair.id}` === view.verdict)
      : undefined
    if (litPair) return pairProof(access, policy, litPair)
    const nodes = new Set<string>()
    const edges = new Set<string>()
    for (const pair of pairs.pairs) {
      if (pair.outcome !== 'allowed') continue
      const { nodes: who, edges: what } = pairProof(access, policy, pair)
      for (const path of who) nodes.add(path)
      for (const edge of what) edges.add(edge)
    }
    return { nodes: [...nodes], edges: [...edges] }
  }, [access, pairs, policy, view.verdict])

  // What the identity reads, decided Node by Node. The map marks Nodes once every one is
  // decided; until then it draws them unmarked. One layer marks a card at a time: while a Policy
  // or one of its pairs is lit, its pairs do, and the identity's marks — who the map is read as,
  // what it reads — stand aside, still decided, until the Policy is no longer selected.
  const readAs = policy ? undefined : identity
  const reads = useReads(dataLens === 'rules' ? access : undefined, identity)
  const complete = reads && reads.pending === 0 && readAs !== undefined ? reads : undefined

  // The dataset's Scenarios, each step judged on the dataset as written and the Schema as it
  // stands: again whenever either changes. Their standing is read without proofs; the one open
  // is read with every verdict's proof.
  const scenarios = useScenarios(domainId, dataset.path)
  const judging = useMemo(
    (): Judging => ({
      model,
      ...(bundle ? { bundle } : {}),
      ...(access ? { access } : {}),
      ...(unread ? { unread } : {}),
    }),
    [access, bundle, model, unread],
  )
  const behavior = dataLens === 'behavior'
  const judged = useMemo(
    () =>
      behavior ? scenarios.scenarios.map((one) => judgeScenario(judging, one, 'outcome')) : [],
    [behavior, judging, scenarios.scenarios],
  )
  const openSource = view.scenario
    ? scenarios.scenarios.find((one) => one.id === view.scenario)
    : undefined
  const open = useMemo(
    () => (behavior && openSource ? judgeScenario(judging, openSource, 'full') : undefined),
    [behavior, judging, openSource],
  )
  const step = open && view.step ? open.steps.find((one) => one.step.id === view.step) : undefined
  // What the step selected marks on the map: who acts and how, and where its function's
  // declared writes would land — marked, never applied.
  const marks = useMemo(() => (step ? stepMarksOf(step) : undefined), [step])

  // What a selection reaches: it and the ends of its Edges; a Policy, what it admits.
  const reach = useMemo(() => {
    const paths = new Set<string>()
    for (const path of admits?.nodes.slice(0, FOCUS_NEIGHBOURS) ?? []) paths.add(path)
    if (selectedPath && model.nodes.has(selectedPath)) {
      paths.add(selectedPath)
      for (const edge of edgesOf(model, selectedPath).slice(0, FOCUS_NEIGHBOURS))
        paths.add(edge.from === selectedPath ? edge.to : edge.from)
    }
    const edge = selectedEdge === undefined ? undefined : model.edges[selectedEdge]
    if (edge) paths.add(edge.from).add(edge.to)
    return [...paths].filter((path) => model.nodes.has(path))
  }, [admits, model, selectedEdge, selectedPath])
  // What a selection draws as its own cards whatever the bound: what it reaches and, in Rules,
  // the identity read as.
  const focus = useMemo(() => {
    const paths = [...reach]
    if (dataLens === 'rules' && !policy && identity !== ANYONE && paths.length > 0)
      paths.push(identity)
    if (step) paths.push(...step.facts.nodes, ...(step.facts.actor ? [step.facts.actor] : []))
    return [...new Set(paths)].filter((path) => model.nodes.has(path)).sort()
  }, [dataLens, identity, model, policy, reach, step])

  const canvasScope = `${domainId}:data:${dataset.id}`
  const storedCollapsed = useCanvas((state) => state.collapsed[canvasScope])
  const setCollapsed = useCanvas((state) => state.setCollapsed)
  const isolatedId = useCanvas((state) => state.isolated[canvasScope])
  const setIsolated = useCanvas((state) => state.setIsolated)
  const collapsed = useMemo(
    () => (storedCollapsed ? new Set(storedCollapsed) : regionsAtRest(model)),
    [model, storedCollapsed],
  )
  // A selection opens, while it lasts, the collapsed regions holding what it reaches, so each of
  // its Edges is drawn. A region the reader shuts stays shut for that selection.
  const [shut, setShut] = useState<{ selection: string; groups: ReadonlySet<string> }>()
  const selection = `${scope}|${selected ?? ''}`
  const opening = useMemo(() => {
    if (!selected || isolatedId) return NOTHING
    const closed = shut?.selection === selection ? shut.groups : NOTHING
    const regions = new Set<string>()
    // The identity's own region opens only when the selection reaches it.
    for (const path of reach) {
      const region = model.classOf.get(path)?.target
      if (region && collapsed.has(region) && !closed.has(region)) regions.add(region)
    }
    return regions.size > 0 ? regions : NOTHING
  }, [collapsed, isolatedId, model, reach, selected, selection, shut])
  const shownCollapsed = useMemo(
    () => (opening.size > 0 ? new Set([...collapsed].filter((id) => !opening.has(id))) : collapsed),
    [collapsed, opening],
  )

  const atRest = useMemo(
    () =>
      projectData(model, {
        lens: dataLens,
        collapsed,
        identities,
        ...(readAs === undefined ? {} : { as: readAs }),
        reads: complete,
        ...(marks ? { step: marks } : {}),
      }),
    [collapsed, complete, dataLens, identities, marks, model, readAs],
  )
  const focused = focus.length > 0 || opening.size > 0
  const projection = useMemo(
    () =>
      focused
        ? projectData(model, {
            lens: dataLens,
            collapsed: shownCollapsed,
            focus,
            identities,
            ...(readAs === undefined ? {} : { as: readAs }),
            reads: complete,
            ...(marks ? { step: marks } : {}),
          })
        : atRest,
    [atRest, complete, dataLens, focus, focused, identities, marks, model, readAs, shownCollapsed],
  )
  const isolated = useMemo(
    () => (isolatedId ? isolateScene(projection.scene, isolatedId) : null),
    [isolatedId, projection],
  )
  const shown = isolated ?? projection.scene
  const arrangement = useMemo(
    () => arrange(shown, { collapsed: isolated ? NOTHING : shownCollapsed }),
    [isolated, shown, shownCollapsed],
  )

  // The arrangement the reader made is kept per dataset, the same through every lens. A focus
  // lays its few new cards in among the boxes as they stood at rest and moves none of them.
  const { pins: lensPins, place, reset } = useLensPins(domainId, pinsLensOf(dataset.id))
  const shownFrame = useRef<Frame | null>(null)
  const restPins = useRef<{ key: string; pins: Pins; laidWith: Pins } | null>(null)
  const restKey = arrangementKey(atRest.scene, collapsed)
  const rest = restPins.current
  const pins = isolated
    ? NO_PINS
    : focused && rest && rest.key === restKey && rest.laidWith === lensPins
      ? rest.pins
      : lensPins
  const onFrame = useCallback(
    (frame: Frame) => {
      shownFrame.current = frame
      if (frame.arrangement.key === restKey)
        restPins.current = { key: restKey, pins: frame.pins, laidWith: frame.laidWith }
    },
    [restKey],
  )
  const onPlace = useCallback(
    (next: Pins) => (isolated ? undefined : place(next)),
    [isolated, place],
  )
  const onAutoArrange = useCallback(() => {
    const before = reset()
    toast(`${datasetLabel(dataset)} is arranged automatically again`, {
      action: { label: 'Undo', onClick: () => place(before) },
    })
  }, [dataset, place, reset])
  const onToggleGroup = useCallback(
    (group: string) => {
      if (opening.has(group)) {
        const closed = shut?.selection === selection ? shut.groups : NOTHING
        setShut({ selection, groups: new Set([...closed, group]) })
        return
      }
      // Opening or closing a region keeps every other box where the reader sees it.
      const frame = shownFrame.current
      if (!isolated && frame && frame.arrangement.key === arrangement.key) place(frame.pins)
      const next = new Set(collapsed)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      setCollapsed(canvasScope, [...next].sort())
    },
    [arrangement, canvasScope, collapsed, isolated, opening, place, selection, setCollapsed, shut],
  )
  const onIsolate = useCallback(
    (id: string | null) => setIsolated(canvasScope, id),
    [canvasScope, setIsolated],
  )
  const onSelect = useCallback((id: string | undefined) => select(scope, id), [scope, select])
  const selectAndReveal = useCallback(
    (id: string | undefined) => select(scope, id, true),
    [scope, select],
  )

  // The verdicts of the selection, as the identity read as.
  const verdicts = useMemo((): Decided | undefined => {
    if (dataLens !== 'rules' || !access) return undefined
    if (selectedPath && model.nodes.has(selectedPath))
      return { kind: 'node', ...nodeVerdicts(access, identity, selectedPath) }
    const edge = selectedEdge === undefined ? undefined : model.edges[selectedEdge]
    if (edge)
      return {
        kind: 'edge',
        traverse: edgeVerdict(access, identity, edge, 'traverse'),
        read: edgeVerdict(access, identity, edge, 'read'),
      }
    return undefined
  }, [access, dataLens, identity, model, selectedEdge, selectedPath])
  const lit = view.verdict === NO_VERDICT ? undefined : (view.verdict ?? defaultLit(verdicts))
  const litVerdict = verdicts ? listVerdicts(verdicts).find((one) => one.id === lit) : undefined
  const onLight = useCallback(
    (id: string) => lightVerdict(scope, id === lit ? NO_VERDICT : id),
    [lightVerdict, lit, scope],
  )

  // The walk of the rule that decides the lit verdict — or the lit pair of the Policy selected —
  // on the case it decided: each step at the Node or Edge it stands at, numbered as the stage and
  // the panel's path number it. None where the panel stages none.
  const walk = useMemo((): OwnWalk | undefined => {
    if (isolated || !access || dataLens === 'behavior') return undefined
    if (policy) {
      const pair = view.verdict?.startsWith(PAIR)
        ? pairs?.pairs.find((one) => `${PAIR}${one.id}` === view.verdict)
        : undefined
      const explained = pair ? pairCase(access, policy, pair) : undefined
      const rule = policy.reading.status === 'read' ? policy.reading.rule : undefined
      if (explained?.status !== 'explained' || !rule) return undefined
      const { situation, fact } = explained.verdict
      return walkOnMap(projection, walkFactsOf(rule, access.data, situation, fact), 'who')
    }
    if (dataLens !== 'rules' || !selected || !litVerdict?.decided) return undefined
    if (litVerdict.by.kind !== 'rule') return undefined
    const { situation, fact } = litVerdict.decided
    return walkOnMap(
      projection,
      walkFactsOf(litVerdict.by.rule, access.data, situation, fact),
      litVerdict.slot,
    )
  }, [access, dataLens, isolated, litVerdict, pairs, policy, projection, selected, view.verdict])

  // Through Rules the map lights what the identity reads; with a selection, the facts its lit
  // verdict stands on. Without either it lights the selection's neighbourhood, as Structure does.
  // A Policy selected lights, through Structure and Rules, who it admits to what, or the pair lit.
  // Through Behavior a step selected lights who it acts as, what it acts on, the Edges its
  // verdict stands on and the regions its function is declared to write; a Scenario open
  // lights every Node and Edge its steps name.
  const spotlight = useMemo(() => {
    if (isolated) return undefined
    if (dataLens === 'behavior') {
      const steps = step ? [step] : selected ? [] : (open?.steps ?? [])
      if (steps.length === 0) return undefined
      const all = [...new Set([...(selected ? [selected] : []), ...stepsLit(projection, steps)])]
      return all.length > 0 ? all : undefined
    }
    if (policy) {
      const ids = admits ? sceneIdsOf(projection, admits) : []
      return ids.length > 0 ? ids : undefined
    }
    if (dataLens !== 'rules') return undefined
    const as = identity === ANYONE ? [] : [identity]
    if (selected) {
      if (!litVerdict) return undefined
      const ids = sceneIdsOf(projection, {
        nodes: [...litVerdict.proof.nodes, ...as],
        edges: litVerdict.proof.edges,
      })
      return [...new Set([selected, ...ids])]
    }
    if (!complete) return undefined
    const readable = [...complete.verdicts]
      .filter(([, one]) => one.outcome === 'allowed')
      .map(([path]) => path)
    const ids = sceneIdsOf(projection, { nodes: [...readable, ...as], edges: [] })
    return ids.length > 0 ? ids : undefined
  }, [
    admits,
    complete,
    dataLens,
    identity,
    isolated,
    litVerdict,
    open,
    policy,
    projection,
    selected,
    step,
  ])

  // Pinning a verdict, through Rules: added to a Scenario of the dataset, or to a new one.
  const pinning = useMemo((): Pinning | undefined => {
    if (dataLens !== 'rules') return undefined
    const onPin = (added: ScenarioStep, into: Scenario | undefined) => {
      const ask = askOf(model, added)
      if (into) {
        const current = scenarios.get(into.id) ?? into
        scenarios.put(withStep(current, added))
        toast(`Pinned to ${current.name}`, {
          description: `${ask}, expected ${added.expect}.`,
          action: {
            label: 'Undo',
            onClick: () => {
              const now = scenarios.get(into.id)
              if (now)
                scenarios.put({ ...now, steps: now.steps.filter((one) => one.id !== added.id) })
            },
          },
        })
        return
      }
      const created: Scenario = {
        id: newScenarioId(),
        dataset: dataset.path,
        name: nameOf(ask),
        steps: [added],
      }
      scenarios.put(created)
      toast(`New Scenario ${created.name}`, {
        description: 'Rename it and read it in the Behavior lens.',
        action: { label: 'Undo', onClick: () => scenarios.remove(created.id) },
      })
    }
    return { model, scenarios: scenarios.scenarios, as: identity, onPin, newId: newScenarioId }
  }, [dataLens, dataset.path, identity, model, scenarios])

  // A step selected is a selection, an identity and a verdict at once: Rules reads it there.
  const onStep = useCallback(
    (judgedStep: JudgedStep | undefined, scenario = open?.scenario.id) => {
      if (!judgedStep || !scenario) {
        if (scenario) openScenario(scope, scenario)
        return
      }
      const target = rulesTargetOf(judging, judgedStep)
      selectStep(scope, {
        scenario,
        step: judgedStep.step.id,
        ...(target ? { selected: target } : {}),
        identity: judgedStep.step.as,
        ...(judgedStep.verdict ? { verdict: judgedStep.verdict.id } : {}),
      })
    },
    [judging, open, openScenario, scope, selectStep],
  )
  const setLens = useUI((state) => state.setLens)
  const onRules = useCallback(
    (judgedStep: JudgedStep) => {
      onStep(judgedStep)
      setLens('rules')
    },
    [onStep, setLens],
  )
  // The way to a first step: Rules, on a Node whose verdicts can be pinned.
  const onFirstStep = useCallback(() => {
    if (!selectedPath) {
      const first = model.order.find((node) => !identities.has(node.path)) ?? model.order[0]
      if (first) select(scope, nodeId(first.path), true)
    }
    setLens('rules')
  }, [identities, model, scope, select, selectedPath, setLens])

  // Above the dataset's Nodes the Index lists, through Behavior, its Scenarios with their
  // standing; through Rules, the Domain's Policies.
  const [indexShut, setIndexShut] = useState<ReadonlySet<string>>(NOTHING)
  const listed = useMemo(() => {
    if (isolated) return undefined
    if (behavior)
      return withGroup(
        atRest.index,
        { id: SCENARIOS, label: 'Scenarios' },
        scenarioEntries(judged),
        `scenarios:${judged.map((one) => `${one.scenario.id}=${one.standing}`).join(',')}`,
      )
    if (dataLens === 'rules' && rules) {
      const entries = policyEntries(rules)
      return entries.length > 0
        ? withGroup(
            atRest.index,
            { id: POLICIES, label: 'Policies' },
            entries,
            `policies:${entries.map((entry) => `${entry.id}=${entry.sublabel}`).join(',')}`,
          )
        : undefined
    }
    return undefined
  }, [atRest.index, behavior, dataLens, isolated, judged, rules])
  const indexCollapsed = useMemo(
    () => (listed && indexShut.size > 0 ? new Set([...collapsed, ...indexShut]) : collapsed),
    [collapsed, indexShut, listed],
  )
  const onIndexSelect = useCallback(
    (id: string) => {
      if (id === SCENARIOS) return openScenario(scope, undefined)
      if (id === POLICIES) return
      if (id.startsWith(SCENARIO_ENTRY)) return openScenario(scope, id.slice(SCENARIO_ENTRY.length))
      // A Policy has no card to bring into view: the map lights what it admits instead.
      if (rules && policyOf(rules, id)) return select(scope, id)
      selectAndReveal(id)
    },
    [openScenario, rules, scope, select, selectAndReveal],
  )
  const onIndexToggle = useCallback(
    (group: string) => {
      if (group !== SCENARIOS && group !== POLICIES) return onToggleGroup(group)
      setIndexShut((shut) => {
        const next = new Set(shut)
        if (!next.delete(group)) next.add(group)
        return next
      })
    },
    [onToggleGroup],
  )
  const indexSelected =
    behavior && listed && (step || !selected) && open
      ? `${SCENARIO_ENTRY}${open.scenario.id}`
      : selected

  const panelSide = useUI((state) => state.panelSide)
  // What stands at the pane's foot: the agent's dock, or the stage while it is open. The Read as
  // card stands above it, and framing leaves free both it and the card.
  const stageCover = useStage((state) => state.cover)
  const foot = Math.max(
    panelSide === 'bottom' ? DOCK_CLEARANCE : 0,
    stageCover > 0 ? stageCover + 12 : 0,
  )
  const insets = useMemo(
    () => ({
      top: TOOLBAR_CLEARANCE,
      right: 0,
      bottom: foot + (dataLens === 'rules' ? 64 + 20 * Math.min(model.classes.length, 8) : 0),
      left: 0,
    }),
    [dataLens, foot, model.classes.length],
  )

  // Esc backs out of the selection, then through Behavior out of the Scenario open; the canvas
  // leaves an isolated neighbourhood first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const current = useDataView.getState().views[scope]
      if (behavior && current?.scenario && !current.selected && !current.step)
        openScenario(scope, undefined)
      else select(scope, undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [behavior, openScenario, scope, select])

  const messages = [
    ...(bundleError
      ? [
          `The Schema could not be read, so the dataset is drawn without its rules: ${errorText(bundleError)}`,
        ]
      : []),
    ...(dataset.schemaMatch
      ? []
      : [
          `This dataset was admitted against Schema revision ${dataset.revision.slice(0, 12)}, not the one shown: it is extracted again once the Schema settles.`,
        ]),
  ]

  return (
    <div
      className="flex h-full flex-col"
      data-testid="data-level"
      data-state="ready"
      data-lens={lens}
      data-dataset={dataset.id}
      data-dataset-path={dataset.path}
    >
      <ErrorBanner title="Dataset" messages={messages} />
      <div className="flex min-h-0 flex-1">
        <IndexRail
          // The Index lists the dataset at rest: a selection's focus never reflows it.
          scene={isolated ?? listed ?? atRest.index}
          domainId={domainId}
          selected={indexSelected}
          collapsed={isolated ? NOTHING : indexCollapsed}
          onToggleGroup={onIndexToggle}
          onSelect={onIndexSelect}
          onClearSelection={() => select(scope, undefined)}
          dataLevel
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <DataBar
            datasetName={datasetLabel(dataset)}
            nodes={model.order.length}
            edges={model.edges.length}
            factor={factor}
            onFactor={(next) => setFactor(scope, next)}
            onDatasets={() => openDataLevel(null)}
          >
            {behavior ? (
              <BarLine glyph={GLYPHS.function} title="What a call does">
                {open
                  ? `${open.scenario.name} · ${open.steps.length} ${open.steps.length === 1 ? 'step' : 'steps'}, each judged on this dataset`
                  : 'open a Scenario in the panel, or select a Node to read the steps that involve it'}
              </BarLine>
            ) : (
              <BarLine
                glyph={GLYPHS.policy}
                title={`What ${identityLabel(model, identity)} may read`}
              >
                {policy
                  ? `set aside while the Policy ${policy.name} is selected`
                  : reads && reads.pending === 0
                    ? `${reads.total.allowed} of ${reads.total.total} Nodes${reads.total.unknown > 0 ? ` · ${reads.total.unknown} the rules cannot tell` : ''}`
                    : access
                      ? 'deciding…'
                      : 'no rule of the Domain can be read'}
              </BarLine>
            )}
          </DataBar>
          <div
            className="relative min-h-0 flex-1"
            {...(behavior ? { 'data-testid': 'data-behavior' } : {})}
          >
            {
              <SceneCanvas
                key={`${domainId}:${dataset.id}`}
                scene={shown}
                arrangement={arrangement}
                domainId={domainId}
                selected={selected}
                spotlight={spotlight}
                {...(walk ? { walk } : {})}
                // A step or a verdict lights the Edges its proof names, not every one between them.
                spotlightLinks={behavior || selected ? 'named' : 'among'}
                revealTarget={reveal}
                isolated={isolated ? isolatedId : undefined}
                insets={insets}
                pins={pins}
                onPlace={onPlace}
                onAutoArrange={lensPins.size > 0 && !isolated ? onAutoArrange : undefined}
                onFrame={onFrame}
                onSelect={onSelect}
                onRevealed={revealed}
                onToggleGroup={onToggleGroup}
                onIsolate={onIsolate}
                lens={dataLens}
                // A new reading — the lens, the selection, the identity's marks, the step — frames the map again.
                frameToken={`${dataLens}|${selected ?? ''}|${dataLens === 'rules' ? `${identity}:${complete ? 'read' : ''}` : ''}|${behavior ? (step?.step.id ?? open?.scenario.id ?? '') : ''}`}
              />
            }
            {lens === 'rules' && (
              <IdentityPicker
                model={model}
                identities={access?.identities ?? []}
                identity={identity}
                label={identityLabel(model, identity)}
                anyone={access?.anyone !== undefined}
                {...(policy ? { setAside: policy.name } : reads ? { reads } : {})}
                onPick={(next) => setIdentity(scope, next)}
                onSelectClass={(target) => selectAndReveal(target)}
                {...(foot > 0 ? { bottom: foot } : {})}
              />
            )}
            {!panelOpen && <PanelOpener label="Dataset panel" onOpen={() => setPanelOpen(true)} />}
          </div>
        </div>
        {panelOpen && (
          <PanelShell onClose={() => (selected ? select(scope, undefined) : setPanelOpen(false))}>
            {behavior && (step || !selected) ? (
              <BehaviorPanel
                domainId={domainId}
                model={model}
                judged={judged}
                {...(open ? { open } : {})}
                {...(step ? { step: step.step.id } : {})}
                scenarios={scenarios}
                onOpen={(id) => openScenario(scope, id)}
                onStep={(next) => onStep(next)}
                onRules={onRules}
                onFirstStep={onFirstStep}
              />
            ) : (
              <DataPanel
                domainId={domainId}
                lens={dataLens}
                model={model}
                {...(access ? { access } : {})}
                {...(unread ? { unread } : {})}
                identities={identities}
                identity={identity}
                {...(complete ? { reads: complete } : {})}
                projection={projection}
                {...(selected ? { selected } : {})}
                {...(policy ? { policy } : {})}
                {...(pairs ? { pairs } : {})}
                {...(verdicts ? { decided: verdicts } : {})}
                {...(lit ? { lit } : {})}
                onSelect={selectAndReveal}
                onLight={onLight}
                onIdentity={(next) => setIdentity(scope, next)}
                {...(pinning ? { pinning } : {})}
                {...(behavior && (selectedPath || selectedEdge !== undefined)
                  ? {
                      steps: (
                        <StepsInvolving
                          judged={judged}
                          involves={involving(model, selectedPath, selectedEdge)}
                          onStep={(scenario, next) => onStep(next, scenario.id)}
                          onFirstStep={onFirstStep}
                        />
                      ),
                    }
                  : {})}
              />
            )}
          </PanelShell>
        )}
      </div>
    </div>
  )
}

/** Whether a stored selection still names something of the dataset, or a Policy its Domain reads. */
function isSelectable(model: DatasetModel, id: string, rules: DomainRules | undefined): boolean {
  if (id.startsWith('policy.')) return rules !== undefined && policyOf(rules, id) !== undefined
  const path = pathOfNodeId(id)
  if (path !== undefined) return model.nodes.has(path)
  const index = indexOfEdgeId(id)
  if (index !== undefined) return model.edges[index] !== undefined
  if (isStandIn(id)) return model.classByTarget.has(regionOfStandIn(id))
  if (id.startsWith('outside.')) return model.outside.has(id.slice('outside.'.length))
  return model.classByTarget.has(id) || isGathered(id)
}

/** The Policy a selection id names (`policy.<key>`), among those the Domain declares or checks. */
function policyOf(rules: DomainRules, id: string): PolicyRule | undefined {
  return (
    rules.policies.find((policy) => policy.target === id) ??
    rules.imported.find((policy) => policy.target === id)
  )
}

function listVerdicts(decided: Decided) {
  return decided.kind === 'node'
    ? [decided.read, ...decided.traverse, ...decided.calls]
    : [decided.traverse, decided.read]
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

function Status({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      role="status"
      data-testid="scene-canvas-status"
      className="flex h-full flex-col items-center justify-center gap-1.5 bg-canvas px-6 text-center text-muted-foreground"
    >
      <span>{title}</span>
      {detail && <span className="text-xs">{detail}</span>}
    </div>
  )
}

/** A dataset the Studio could not read: which one, its file and why, nothing drawn. */
function FailedDataset({ failure }: { failure: StudioDatasetFailure }) {
  return (
    <div
      role="alert"
      data-testid="data-level-failed"
      className="flex h-full items-center justify-center bg-canvas px-6"
    >
      <div className="w-full max-w-xl space-y-3 rounded-lg border border-destructive/30 bg-card p-5 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{datasetLabel(failure)}</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            This dataset could not be read, so it holds no Node to draw. Fix its module and save it:
            the dataset is read again.
          </p>
        </div>
        <dl className="space-y-2 text-[12px]">
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">File</dt>
            <dd data-testid="data-level-failed-path" className="break-all font-mono">
              {failure.path}
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">Reason</dt>
            <dd>
              <pre
                data-testid="data-level-failed-reason"
                className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 font-mono text-destructive"
              >
                {failure.error.message}
              </pre>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

/** Whether a step involves the Node or the Edge selected. */
function involving(model: DatasetModel, path: string | undefined, edge: number | undefined) {
  const selectedEdge = edge === undefined ? undefined : model.edges[edge]
  const ref = selectedEdge ? edgeRef(selectedEdge) : undefined
  return ({ step }: JudgedStep) => {
    if (path !== undefined) return involves(step, path)
    if (!ref || !step.on || !('edge' in step.on)) return false
    const on = step.on.edge
    return on.from === ref.from && on.relation === ref.relation && on.to === ref.to
  }
}

/** The dataset's Scenarios as Index entries, each with its standing. */
function scenarioEntries(judged: readonly JudgedScenario[]): SceneEntry[] {
  return judged.map((one) => ({
    id: `${SCENARIO_ENTRY}${one.scenario.id}`,
    kind: 'scenario',
    label: one.scenario.name,
    sublabel: one.standing,
    group: SCENARIOS,
    tone: one.broken.length > 0 ? ('delete' as const) : ('call' as const),
    icon: { glyph: 'scenario' as const },
    keywords: one.steps.map((step) => step.ask),
  }))
}

/**
 * The Domain's Policies as Index entries, as its Schema's Rules lens lists them: its own, and
 * another Domain's that one of its places checks; each counted by the places it sits on.
 */
function policyEntries(rules: DomainRules): SceneEntry[] {
  const places = (count: number) => `${count} ${count === 1 ? 'place' : 'places'}`
  return [...rules.policies, ...rules.imported].flatMap((policy): SceneEntry[] => {
    const own = policy.origin === rules.origin
    if (!own && policy.sitsOn.length === 0) return []
    return [
      {
        id: policy.target,
        kind: 'policy',
        label: policy.name,
        sublabel: own
          ? places(policy.sitsOn.length)
          : `${originShort(policy.origin)} · ${places(policy.sitsOn.length)}`,
        group: POLICIES,
        tone: 'who',
        icon: { glyph: 'policy' },
        ...(policy.description ? { keywords: [policy.description] } : {}),
      },
    ]
  })
}

/**
 * The Index with a group of its own above the dataset's Nodes and Edges, listed as the map lists
 * them. With no entry the group lists none: the panel says what would fill it.
 */
function withGroup(index: Scene, group: SceneGroup, entries: SceneEntry[], key: string): Scene {
  const nodes = index.nodes.map((node) => ({
    id: node.id,
    ...(node.anchor ? { anchor: node.anchor } : {}),
    kind: node.kind,
    label: node.label,
    ...(node.sublabel ? { sublabel: node.sublabel } : {}),
    ...(node.group ? { group: node.group } : {}),
    ...(node.tone ? { tone: node.tone } : {}),
    ...(node.icon ? { icon: node.icon } : {}),
    ...(node.keywords ? { keywords: node.keywords } : {}),
  }))
  const links = index.links
    .filter((link) => link.opens === undefined)
    .map((link) => ({
      id: link.id,
      ...(link.anchor ? { anchor: link.anchor } : {}),
      kind: link.kind,
      label: link.label,
      ...(link.group ? { group: link.group } : {}),
      ...(link.tone ? { tone: link.tone } : {}),
      icon: { glyph: 'relationship' as const },
    }))
  return {
    ...index,
    key: `${index.key}|${key}`,
    index: { groups: [group, ...index.groups], entries: [...entries, ...nodes, ...links] },
  }
}
