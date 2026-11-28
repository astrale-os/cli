/**
 * The Data level through Behavior, with a call asked: one of the Domain's functions, on a Node of
 * the dataset, by one of its identities. The bar says the question and what the Kernel would
 * answer; the map draws what the call concerns of the dataset (`callSlice`), the caller marked and
 * every Class the function is declared to write marked with its verbs; the panel reads the verdict
 * with its reason, the declared writes and what they require.
 *
 * Nothing is applied: a call's writes are read from its source as declared, and the verdict is
 * decided on the dataset as written.
 */

import type { StudioDataset, StudioSchemaBundle } from '@shared/contracts/schema'

import { ANYONE } from '@shared/contracts/scenarios'
import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { Pins } from '../../canvas/pins'
import type { Scene } from '../../scene/types'
import type { Candidate } from './fill'
import type { Slot } from './question'

import { TOOLBAR_CLEARANCE } from '../../../schema-studio/palette'
import { PanelOpener, PanelShell } from '../../../schema-studio/panel-shell'
import { GLYPHS } from '../../canvas/glyphs'
import { SceneCanvas } from '../../canvas/scene-canvas'
import { TONE_TEXT } from '../../canvas/tones'
import { IndexRail } from '../../index-rail/index-rail'
import { Empty, Fact, Meta, Page, Section, Title } from '../../inspector/parts'
import { arrange } from '../../scene/arrange'
import { DATA_ACCENT } from '../accent'
import { accessOf, callablesOf as callablesAt } from '../access'
import { Declared } from '../behavior-panel'
import { OUTCOME_MARKS } from '../marks'
import { datasetLabel, datasetModel, identityLabel, nodeId, sliceModel } from '../model'
import { DataPanel } from '../panel'
import { projectData, regionsAtRest, stepMarksOf } from '../project'
import { withStep } from '../scenario-edits'
import { type Judging, judgeStep } from '../scenarios'
import { datasetScope, useDataView, useDatasetView } from '../store'
import { newScenarioId, useScenarios } from '../use-scenarios'
import {
  callablesOf,
  callEntries,
  callKeyOf,
  callSlice,
  FUNCTIONS_GROUP,
  pickTarget,
  stepOf,
  targetsOf,
} from './call'
import { whyWords } from './fill'
import { AsChip, DataBar, SlotChip } from './question-bar'
import { scaled } from './scale'
import { sliceOf } from './scenes'
import { useAsk, useAskView } from './store'

const NOTHING: ReadonlySet<string> = new Set()
const NO_PINS: Pins = new Map()
const INSETS = { top: TOOLBAR_CLEARANCE, right: 0, bottom: 96, left: 0 }
/** The slot a call's Node is held in, as the bar's chip reads it. */
const ON: Slot = {
  id: 'on',
  label: 'on',
  optional: false,
  kind: 'node',
  offered: false,
  applied: true,
}

export interface CallLevelProps {
  domainId: string
  origin: string
  dataset: StudioDataset
  bundle: StudioSchemaBundle
}

const SCENARIOS_GROUP = 'ask.scenarios'
const SCENARIO = 'scenario.'

export function CallLevel({ domainId, origin, dataset, bundle }: CallLevelProps) {
  const scope = datasetScope(domainId, dataset.id)
  const view = useAskView(scope)
  const call = view.call!
  const { askCall, select, setFactor, setPanelOpen } = useAsk.getState()
  const panelOpen = useAsk((state) => state.panelOpen)
  const openDataLevel = useUI((state) => state.openDataLevel)
  const identity = useDatasetView(scope).identity
  const setIdentity = useDataView((state) => state.setIdentity)
  const openScenario = useDataView((state) => state.openScenario)

  const grown = useMemo(() => scaled(dataset, bundle, view.factor), [bundle, dataset, view.factor])
  const model = useMemo(() => datasetModel(grown, bundle), [bundle, grown])
  const [now] = useState(() => new Date().toISOString())
  const decided = useMemo(() => accessOf(bundle, model, now), [bundle, model, now])
  const access = 'status' in decided ? undefined : decided
  const identities = access?.identities ?? []
  const as =
    identity === ANYONE || identities.some((one) => one.id === identity) ? identity : ANYONE

  const callable = useMemo(
    () => callablesOf(bundle).find((one) => one.key === call.fn),
    [bundle, call.fn],
  )
  // A Method is asked on a Node of its Class: the reader's, else a pick made once, with its reason.
  const targets = useMemo(
    () =>
      callable
        ? targetsOf(
            model,
            bundle,
            callable,
            access ? (cls) => callablesAt(access, cls).map((one) => one.key) : undefined,
          )
        : [],
    [access, bundle, callable, model],
  )
  const on = call.on !== undefined && targets.includes(call.on) ? call.on : undefined
  useEffect(() => {
    if (!callable || callable.static || on !== undefined) return
    const pick = pickTarget(model, targets, call.on ?? view.carried)
    if (pick) askCall(scope, { fn: call.fn, on: pick.path, why: pick.why })
  }, [askCall, call.fn, call.on, callable, model, on, scope, targets, view.carried])

  const question = useMemo(
    () =>
      callable && (callable.static || on !== undefined)
        ? { fn: call.fn, as, ...(on === undefined ? {} : { on }) }
        : undefined,
    [as, call.fn, callable, on],
  )
  const judging = useMemo<Judging>(
    () => ({
      model,
      bundle,
      ...(access ? { access } : {}),
      ...('status' in decided ? { unread: decided } : {}),
    }),
    [access, bundle, decided, model],
  )
  const judged = useMemo(
    () => (question ? judgeStep(judging, stepOf(question), 1, 'full') : undefined),
    [judging, question],
  )
  const slice = useMemo(
    () => (judged && question ? callSlice(model, judged, question) : undefined),
    [judged, model, question],
  )
  const sliced = useMemo(
    () => (slice ? sliceModel(model, slice.nodes, slice.edges, sliceOf(grown, slice)) : undefined),
    [grown, model, slice],
  )
  const identitySet = useMemo(() => new Set(identities.map((one) => one.id)), [identities])
  const [shut, setShut] = useState<readonly string[]>()
  const collapsed = useMemo(
    () => (shut ? new Set(shut) : sliced ? regionsAtRest(sliced) : NOTHING),
    [shut, sliced],
  )
  const projection = useMemo(
    () =>
      sliced && judged
        ? projectData(sliced, {
            lens: 'behavior',
            collapsed,
            identities: identitySet,
            step: stepMarksOf(judged),
          })
        : undefined,
    [collapsed, identitySet, judged, sliced],
  )
  const scene = useMemo<Scene>(
    () =>
      projection?.scene ?? {
        key: `call:${call.fn}:none`,
        nodes: [],
        links: [],
        groups: [],
        folded: [],
        empty: callable
          ? `The dataset holds no Node ${call.fn} can be called on.`
          : `The Schema declares no function ${call.fn}.`,
      },
    [call.fn, callable, projection],
  )
  const arrangement = useMemo(() => arrange(scene, { collapsed }), [collapsed, scene])
  const [pins, setPins] = useState<Pins>(NO_PINS)
  const selected =
    view.selected !== undefined &&
    (scene.nodes.some((node) => node.id === view.selected) ||
      scene.links.some((link) => link.id === view.selected) ||
      scene.groups.some((group) => group.id === view.selected))
      ? view.selected
      : undefined

  const labelOf = useCallback((path: string) => model.nodes.get(path)?.label ?? path, [model])
  const candidates = useCallback(
    (): Candidate[] =>
      targets.map((path) => ({
        path,
        label: labelOf(path),
        variables: model.nodes.get(path)?.variables ?? [],
      })),
    [labelOf, model, targets],
  )

  // Esc backs out of the selection, then out of the call.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (useAsk.getState().views[scope]?.selected) select(scope, undefined)
      else askCall(scope, undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [askCall, scope, select])

  // A call worth keeping becomes a step of a Scenario of this dataset: the first one, or a new one.
  const scenarios = useScenarios(domainId, dataset.path)
  // The Index: the dataset's Scenarios, then every function of the Domain, each to ask.
  const index = useMemo<Scene>(
    () => ({
      key: `calls:${dataset.id}:${scenarios.scenarios.map((one) => one.id).join(',')}`,
      nodes: [],
      links: [],
      groups: [],
      folded: [],
      index: {
        groups: [
          { id: SCENARIOS_GROUP, label: 'Scenarios' },
          { id: FUNCTIONS_GROUP, label: 'Functions' },
        ],
        entries: [
          ...scenarios.scenarios.map((one) => ({
            id: `${SCENARIO}${one.id}`,
            kind: 'scenario',
            label: one.name,
            group: SCENARIOS_GROUP,
            tone: 'fn' as const,
            icon: { glyph: 'scenario' as const },
          })),
          ...callEntries(bundle),
        ],
      },
    }),
    [bundle, dataset.id, scenarios.scenarios],
  )
  const [indexShut, setIndexShut] = useState<ReadonlySet<string>>(NOTHING)
  const keep = () => {
    if (!question || !judged?.verdict) return
    const step = {
      ...stepOf(question),
      id: `step-${Date.now().toString(36)}`,
      expect: judged.verdict.outcome === 'refused' ? ('refused' as const) : ('allowed' as const),
    }
    const into = scenarios.scenarios[0] ?? {
      id: newScenarioId(),
      dataset: dataset.path,
      name: `Calls on ${datasetLabel(dataset)}`,
      steps: [],
    }
    scenarios.put(withStep(into, step))
    toast(`Kept as a step of ${into.name}`)
  }

  const outcome = judged?.verdict?.outcome
  const Outcome = outcome ? OUTCOME_MARKS[outcome].glyph : undefined
  const writes = judged?.declared?.changes ?? []

  return (
    <div
      className="flex h-full flex-col"
      data-testid="data-level"
      data-state="ready"
      data-lens="behavior"
      data-dataset={dataset.id}
      data-dataset-path={dataset.path}
      data-ask-call={call.fn}
    >
      <div className="flex min-h-0 flex-1">
        <IndexRail
          scene={index}
          domainId={domainId}
          selected={callable?.target ?? ''}
          collapsed={indexShut}
          onToggleGroup={(group) =>
            setIndexShut((before) => {
              const next = new Set(before)
              if (next.has(group)) next.delete(group)
              else next.add(group)
              return next
            })
          }
          onSelect={(id) => {
            // A Scenario is read where Scenarios are: the call is let go for it.
            if (id.startsWith(SCENARIO)) {
              askCall(scope, undefined)
              openScenario(scope, id.slice(SCENARIO.length))
              return
            }
            const key = callKeyOf(bundle, id)
            if (key) askCall(scope, { fn: key })
          }}
          onClearSelection={() => askCall(scope, undefined)}
          dataLevel
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <DataBar
            datasetName={datasetLabel(dataset)}
            nodes={model.order.length}
            edges={model.edges.length}
            factor={view.factor}
            onFactor={(factor) => setFactor(scope, factor)}
            onDatasets={() => openDataLevel(null)}
            aside={
              <AsChip
                identities={identities}
                {...(as === ANYONE ? {} : { as })}
                onAs={(next) => setIdentity(scope, next ?? ANYONE)}
                verb="called by"
                whole={{ label: 'anyone', detail: 'no identity the dataset holds' }}
                note="A call is decided for whoever makes it: its contract, then its call rule on the Node."
              />
            }
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <GLYPHS.function aria-hidden className={cn('h-3.5 w-3.5 shrink-0', DATA_ACCENT)} />
                <span data-ask-title className="truncate font-mono text-[12.5px] font-semibold">
                  {call.fn}
                </span>
              </span>
              {callable && !callable.static && (
                <SlotChip
                  slot={ON}
                  value={on === undefined ? undefined : [on]}
                  {...(call.why ? { why: call.why } : {})}
                  labelOf={labelOf}
                  candidatesOf={candidates}
                  valuesOf={() => []}
                  onValue={(values) =>
                    askCall(scope, { fn: call.fn, ...(values?.[0] ? { on: values[0] } : {}) })
                  }
                />
              )}
              <span className="ml-auto inline-flex min-w-0 items-center gap-2">
                {outcome && Outcome && (
                  <span
                    data-ask-verdict={outcome}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium',
                      TONE_TEXT[OUTCOME_MARKS[outcome].tone],
                    )}
                  >
                    <Outcome aria-hidden className="h-3.5 w-3.5" />
                    {OUTCOME_MARKS[outcome].word}
                  </span>
                )}
                <span data-ask-summary className="truncate text-[12px] text-muted-foreground">
                  {writes.length === 0
                    ? 'declared to write nothing'
                    : `declared: ${[...new Set(writes.map((change) => change.word))].join(', ')} · not applied`}
                </span>
                <button
                  type="button"
                  aria-label="Close the call"
                  title="Back to the dataset's Scenarios"
                  onClick={() => askCall(scope, undefined)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          </DataBar>
          <div className="relative min-h-0 flex-1" data-testid="data-behavior">
            <SceneCanvas
              key={`${domainId}:${dataset.id}:call`}
              scene={scene}
              arrangement={arrangement}
              domainId={domainId}
              {...(selected ? { selected } : {})}
              {...(on !== undefined && !selected ? { lights: [nodeId(on)] } : {})}
              insets={INSETS}
              pins={pins}
              onPlace={setPins}
              {...(pins.size > 0 ? { onAutoArrange: () => setPins(NO_PINS) } : {})}
              onSelect={(id) => select(scope, id)}
              onRevealed={() => {}}
              onToggleGroup={(group) => {
                const next = new Set(collapsed)
                if (next.has(group)) next.delete(group)
                else next.add(group)
                setShut([...next].sort())
              }}
              onIsolate={() => {}}
              lens="behavior"
              frameToken={`${call.fn}|${on ?? ''}|${as}|${view.factor}|${selected ?? ''}`}
            />
            {!panelOpen && <PanelOpener label="Call panel" onOpen={() => setPanelOpen(true)} />}
          </div>
        </div>
        {panelOpen && (
          <PanelShell onClose={() => (selected ? select(scope, undefined) : setPanelOpen(false))}>
            {sliced && projection && selected ? (
              <DataPanel
                domainId={domainId}
                lens="behavior"
                model={sliced}
                identities={identitySet}
                identity={as}
                projection={projection}
                selected={selected}
                onSelect={(id) => select(scope, id)}
                onLight={() => {}}
                onIdentity={() => {}}
              />
            ) : (
              <Page domainId={domainId} data-ask-page="call">
                <Title
                  kicker={callable?.owner ? `Call · ${callable.owner}` : 'Call'}
                  name={call.fn}
                  mono
                  domainId={domainId}
                  anchor={callable?.target ?? `function.${call.fn}`}
                >
                  <div className="space-y-1">
                    {callable && !callable.static && (
                      <Fact label="On">
                        {on !== undefined ? labelOf(on) : 'no Node'}
                        {call.why && on !== undefined && (
                          <Meta>picked for you: {whyWords(call.why)}</Meta>
                        )}
                      </Fact>
                    )}
                    <Fact label="By">{identityLabel(model, as)}</Fact>
                  </div>
                </Title>
                <Section label="Verdict" kind="policies" data-ask-verdict-section="">
                  {judged ? (
                    <>
                      <p className="text-[13px] leading-relaxed">
                        {judged.verdict?.sentence ?? `${judged.ask}: ${judged.answer}.`}
                      </p>
                      {judged.verdict && <Meta>{judged.verdict.why}</Meta>}
                      {judged.verdict && judged.verdict.path.length > 0 && (
                        <ul className="space-y-0.5 pl-3 text-[12.5px] leading-relaxed">
                          {judged.verdict.path.map((step) => (
                            <li key={step.edge} className="list-disc">
                              {step.words}
                            </li>
                          ))}
                        </ul>
                      )}
                      {judged.reason && !judged.verdict && <Meta>{judged.reason}</Meta>}
                    </>
                  ) : (
                    <Empty>
                      {callable
                        ? `The dataset holds no Node ${origin} lets ${call.fn} be called on.`
                        : `The Schema declares no function ${call.fn}.`}
                    </Empty>
                  )}
                </Section>
                {judged?.declared && <Declared judged={judged} domainId={domainId} model={model} />}
                {judged?.verdict && (
                  <Section label="Keep" kind="functions">
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      A Scenario keeps this call with the answer expected of it, and says when the
                      answer changes.
                    </p>
                    <button
                      type="button"
                      data-ask-keep
                      onClick={keep}
                      disabled={!scenarios.ready || scenarios.unreadable !== undefined}
                      className="inline-flex h-7 items-center rounded-md border px-2.5 text-[12.5px] font-medium transition-colors hover:bg-accent disabled:text-muted-foreground/60"
                    >
                      Keep as a Scenario step
                    </button>
                  </Section>
                )}
              </Page>
            )}
          </PanelShell>
        )}
      </div>
    </div>
  )
}
