/**
 * The Data level through Structure: a dataset is never drawn whole. At rest the map is the
 * dataset measured against its Schema; with a Query of the Domain open it is the slice that Query
 * reaches, from the Nodes its slots hold, as whoever asks may read it. The Index lists the
 * Queries; the bar over the map says the question; the panel reads its answer row by row.
 *
 * Asking is approximate (`run.ts`) and a dataset read above its written size is faked
 * (`scale.ts`): the level says both wherever they show.
 */

import type { StudioDataset, StudioSchemaBundle } from '@shared/contracts/schema'

import { isReadOnlyDomainId } from '@shared/contracts/workspace'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { usePrepareAgentRequest } from '@/lib/chats'
import { useUI } from '@/lib/store'

import type { Pins } from '../../canvas/pins'
import type { Scene, SceneEntry, SceneGroup } from '../../scene/types'
import type { Slot } from './question'

import { TOOLBAR_CLEARANCE } from '../../../schema-studio/palette'
import { PanelOpener, PanelShell } from '../../../schema-studio/panel-shell'
import { SceneCanvas } from '../../canvas/scene-canvas'
import { IndexRail } from '../../index-rail/index-rail'
import { Page } from '../../inspector/parts'
import { arrange } from '../../scene/arrange'
import { accessOf } from '../access'
import { datasetLabel, datasetModel } from '../model'
import { DataPanel } from '../panel'
import { projectData, regionsAtRest } from '../project'
import { datasetScope } from '../store'
import { useReads } from '../use-decided'
import { AnswerPage, MeasurePage } from './answer-panel'
import { candidatesOf, fill, valuesOf } from './fill'
import { measure } from './measure'
import { bindingOf, slotsOf, stepLabel, titleOf } from './question'
import { type AnswerCount, QuestionBar } from './question-bar'
import { ask } from './run'
import { scaled } from './scale'
import { counted, measuredScene, sliceOf } from './scenes'
import { queryShape } from './shape'
import { useAsk, useAskView } from './store'

const NOTHING: ReadonlySet<string> = new Set()
const NO_PINS: Pins = new Map()
const MEASURE = 'ask.measure'
const QUERY = 'query.'
const INSETS = { top: TOOLBAR_CLEARANCE, right: 0, bottom: 96, left: 0 }

/** What every answer leaves out of the Query's own meaning. */
const ALWAYS_APPROXIMATE = [
  'The answer follows what the Query reads from the Nodes its slots hold.',
  'The Query’s own filters, order and bounds are not applied.',
]

export interface AskLevelProps {
  domainId: string
  origin: string
  dataset: StudioDataset
  bundle: StudioSchemaBundle
}

export function AskLevel({ domainId, origin, dataset, bundle }: AskLevelProps) {
  const scope = datasetScope(domainId, dataset.id)
  const view = useAskView(scope)
  const { open, setValue, applyPicks, setAs, select, setFactor, setPanelOpen } = useAsk.getState()
  const panelOpen = useAsk((state) => state.panelOpen)
  const openDataLevel = useUI((state) => state.openDataLevel)

  // The dataset at the size it is read at, and what its Schema's rules decide on it.
  const grown = useMemo(() => scaled(dataset, bundle, view.factor), [bundle, dataset, view.factor])
  const model = useMemo(() => datasetModel(grown, bundle), [bundle, grown])
  const [now] = useState(() => new Date().toISOString())
  const decided = useMemo(() => accessOf(bundle, model, now), [bundle, model, now])
  const access = 'status' in decided ? undefined : decided
  const identities = access?.identities ?? []
  const as =
    view.as !== undefined && identities.some((one) => one.id === view.as) ? view.as : undefined
  const reads = useReads(as === undefined ? undefined : access, as)
  const deciding = as !== undefined && (!reads || reads.pending > 0)
  const readable = useMemo(() => {
    if (as === undefined || !reads) return undefined
    return (path: string) => {
      const verdict = reads.verdicts.get(path)
      return verdict ? verdict.outcome !== 'refused' : undefined
    }
  }, [as, reads])
  const measured = useMemo(() => measure(model, bundle), [bundle, model])

  // The Query open, the tree it reads and the slots it takes.
  const queries = useMemo(
    () => bundle.overlay.definitions.filter((definition) => definition.kind === 'query'),
    [bundle],
  )
  const definition = queries.find((one) => one.id === view.query)
  const shape = useMemo(
    () => (definition ? queryShape(bundle, definition) : undefined),
    [bundle, definition],
  )
  const slots = useMemo<Slot[]>(
    () => (definition && shape ? slotsOf(bundle, definition, shape) : []),
    [bundle, definition, shape],
  )
  const question = useMemo(
    () => ({ query: view.query ?? '', values: view.values }),
    [view.query, view.values],
  )

  // A Query is filled once when it is opened, as whoever asks may read: the picks a reader can change.
  useEffect(() => {
    if (!definition || !shape || deciding || view.filled === definition.id) return
    applyPicks(
      scope,
      definition.id,
      fill({
        model,
        bundle,
        shape,
        slots,
        question,
        ...(readable ? { readable } : {}),
        ...(view.carried === undefined ? {} : { selected: view.carried }),
      }),
    )
  }, [
    applyPicks,
    bundle,
    deciding,
    definition,
    model,
    question,
    readable,
    scope,
    shape,
    slots,
    view.carried,
    view.filled,
  ])

  const answer = useMemo(
    () =>
      definition && shape && !deciding
        ? ask({
            model,
            bundle,
            shape,
            binding: bindingOf(slots, question),
            ...(readable ? { readable } : {}),
          })
        : undefined,
    [bundle, deciding, definition, model, question, readable, shape, slots],
  )

  // What the map draws: the slice the answer reached, else the dataset measured.
  const slice = useMemo(
    () => (answer ? datasetModel(sliceOf(grown, answer), bundle) : undefined),
    [answer, bundle, grown],
  )
  const identitySet = useMemo(() => new Set(identities.map((one) => one.id)), [identities])
  const [shut, setShut] = useState<Record<string, readonly string[]>>({})
  const sceneKey = definition ? `${QUERY}${definition.id}` : MEASURE
  const collapsed = useMemo(
    () => (shut[sceneKey] ? new Set(shut[sceneKey]) : slice ? regionsAtRest(slice) : NOTHING),
    [sceneKey, shut, slice],
  )
  const projection = useMemo(
    () =>
      slice
        ? projectData(slice, { lens: 'structure', collapsed, identities: identitySet })
        : undefined,
    [collapsed, identitySet, slice],
  )
  const scene = useMemo<Scene>(
    () =>
      projection
        ? projection.scene
        : measuredScene(bundle, model, measured, `${dataset.id}:${view.factor}`),
    [bundle, dataset.id, measured, model, projection, view.factor],
  )
  const arrangement = useMemo(() => arrange(scene, { collapsed }), [collapsed, scene])
  // Where the reader placed boxes, kept per question for the session.
  const [placed, setPlaced] = useState<Record<string, Pins>>({})
  const pins = placed[sceneKey] ?? NO_PINS

  const selected =
    view.selected !== undefined &&
    (scene.nodes.some((node) => node.id === view.selected) ||
      scene.links.some((link) => link.id === view.selected) ||
      scene.groups.some((group) => group.id === view.selected))
      ? view.selected
      : undefined

  // The Index: the dataset measured, then every Query of the Domain under the Class it starts from.
  const index = useMemo<Scene>(() => {
    const groups: SceneGroup[] = [{ id: 'ask.data', label: 'This dataset' }]
    const entries: SceneEntry[] = [
      {
        id: MEASURE,
        kind: 'measure',
        label: 'Measured against its Schema',
        group: 'ask.data',
        tone: 'muted',
        icon: { glyph: 'measure' },
      },
    ]
    for (const each of queries) {
      const root = queryShape(bundle, each).roots[0]?.ref.name ?? 'Other'
      const group = `ask.queries.${root}`
      if (!groups.some((known) => known.id === group))
        groups.push({ id: group, label: `${root} · queries` })
      entries.push({
        id: `${QUERY}${each.id}`,
        kind: 'query',
        label: titleOf(each),
        group,
        tone: 'fn',
        icon: { glyph: 'query' },
        keywords: [each.id, ...(each.name ? [each.name] : []), ...each.classes],
      })
    }
    return {
      key: `ask:${dataset.id}:${queries.length}`,
      nodes: [],
      links: [],
      groups: [],
      folded: [],
      index: { groups, entries, empty: 'The Domain declares no Query.' },
    }
  }, [bundle, dataset.id, queries])
  const [indexShut, setIndexShut] = useState<ReadonlySet<string>>(NOTHING)

  const labelOf = useCallback((path: string) => model.nodes.get(path)?.label ?? path, [model])
  const candidates = useCallback(
    (slot: Slot) =>
      shape
        ? candidatesOf(
            { model, bundle, shape, slots, question, ...(readable ? { readable } : {}) },
            slot,
          )
        : [],
    [bundle, model, question, readable, shape, slots],
  )
  const values = useCallback(
    (slot: Slot) =>
      shape
        ? valuesOf(
            { model, bundle, shape, slots, question, ...(readable ? { readable } : {}) },
            slot,
          )
        : [],
    [bundle, model, question, readable, shape, slots],
  )
  // Each step's count under the name a reader knows it by: its Class the first time the Domain's
  // own Class is read, else the end it is reached by (`parent`, `topic`).
  const counts = useMemo<AnswerCount[]>(() => {
    if (!answer || !shape) return []
    const named = new Set<string>()
    return shape.steps
      .map((step) => {
        const own = step.ref.origin === bundle.ir?.domain && !named.has(step.target)
        named.add(step.target)
        return {
          step: step.id,
          label: own || !step.via ? step.ref.name : stepLabel(bundle, step),
          count: answer.perStep.get(step.id) ?? 0,
        }
      })
      .filter((each, index) => index === 0 || each.count > 0)
  }, [answer, bundle, shape])
  const approximate = useMemo(
    () => [
      ...ALWAYS_APPROXIMATE,
      ...slots
        .filter((slot) => !slot.applied)
        .map((slot) => `The slot ${slot.label} is shown and not applied.`),
      ...(shape?.unplaced ?? []).map((what) => `Not followed: ${what}.`),
    ],
    [shape, slots],
  )

  // Esc backs out of the selection, then out of the Query.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const current = useAsk.getState().views[scope]
      if (current?.selected) select(scope, undefined)
      else if (current?.query) open(scope, undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, scope, select])

  const asLabel = identities.find((one) => one.id === as)?.label
  // A change of what the Domain reads is the agent's to write: the request is put in its
  // composer, unsent. A Domain the Studio only reads offers none.
  const { prepare } = usePrepareAgentRequest()
  const writable = !isReadOnlyDomainId(domainId)
  const askChange = () => {
    if (!definition) return
    const held = slots
      .filter((slot) => view.values[slot.id]?.length)
      .map(
        (slot) =>
          `${slot.label} = ${slot.kind === 'value' ? view.values[slot.id]![0] : view.values[slot.id]!.map(labelOf).join(', ')}`,
      )
    void prepare(
      [
        `In the ${origin} Domain, change the Query \`${definition.id}\` (${definition.file}:${definition.line}).`,
        '',
        'What should change: ',
        '',
        `I was reading it on the dataset ${datasetLabel(dataset)}${held.length > 0 ? `, asked with ${held.join('; ')}` : ''}${asLabel ? `, as ${asLabel}` : ''}.`,
      ].join('\n'),
      'Query request ready — say what should change, then send',
    )
  }
  const askNewQuery = (about?: string) =>
    void prepare(
      [
        `In the ${origin} Domain, write a new Query${about ? ` that starts from ${about}` : ''}.`,
        '',
        'What it should answer: ',
        '',
        `Follow how the Domain's other Queries are written and exported, and check it against the dataset ${datasetLabel(dataset)}.`,
      ].join('\n'),
      'Query request ready — say what it should answer, then send',
    )
  const measuredClass = !definition && selected ? measured.classes.get(selected) : undefined
  const starting = useMemo(
    () =>
      measuredClass
        ? queries.filter((each) =>
            queryShape(bundle, each).roots.some((root) => root.target === measuredClass.target),
          )
        : [],
    [bundle, measuredClass, queries],
  )

  return (
    <div
      className="flex h-full flex-col"
      data-testid="data-level"
      data-state="ready"
      data-lens="structure"
      data-dataset={dataset.id}
      data-dataset-path={dataset.path}
      data-ask={definition?.id ?? 'measure'}
    >
      <div className="flex min-h-0 flex-1">
        <IndexRail
          scene={index}
          domainId={domainId}
          selected={sceneKey}
          collapsed={indexShut}
          onToggleGroup={(group) =>
            setIndexShut((before) => {
              const next = new Set(before)
              if (next.has(group)) next.delete(group)
              else next.add(group)
              return next
            })
          }
          onSelect={(id) => open(scope, id.startsWith(QUERY) ? id.slice(QUERY.length) : undefined)}
          onClearSelection={() => open(scope, undefined)}
          dataLevel
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <QuestionBar
            datasetName={datasetLabel(dataset)}
            nodes={measured.nodes}
            edges={measured.edges}
            factor={view.factor}
            onFactor={(factor) => setFactor(scope, factor)}
            onDatasets={() => openDataLevel(null)}
            identities={identities}
            {...(as === undefined ? {} : { as })}
            onAs={(identity) => setAs(scope, identity)}
            {...(deciding
              ? {
                  deciding: reads
                    ? `deciding ${counted(reads.total.total - reads.pending)} of ${counted(reads.total.total)}`
                    : 'deciding…',
                }
              : {})}
            {...(definition ? { definition } : {})}
            slots={slots}
            values={view.values}
            picked={view.picked}
            labelOf={labelOf}
            candidatesOf={candidates}
            valuesOf={values}
            onValue={(slot, values) => setValue(scope, slot, values)}
            onClose={() => open(scope, undefined)}
            counts={counts}
            hidden={answer?.hidden ?? 0}
            approximate={approximate}
            breaches={measured.breaches}
          />
          <div className="relative min-h-0 flex-1">
            <SceneCanvas
              key={`${domainId}:${dataset.id}:ask`}
              scene={scene}
              arrangement={arrangement}
              domainId={domainId}
              {...(selected ? { selected } : {})}
              insets={INSETS}
              pins={pins}
              onPlace={(next) => setPlaced((before) => ({ ...before, [sceneKey]: next }))}
              {...(pins.size > 0
                ? {
                    onAutoArrange: () =>
                      setPlaced((before) => {
                        const { [sceneKey]: _dropped, ...rest } = before
                        return rest
                      }),
                  }
                : {})}
              onSelect={(id) => select(scope, id)}
              onRevealed={() => {}}
              onToggleGroup={(group) =>
                setShut((before) => {
                  const next = new Set(collapsed)
                  if (next.has(group)) next.delete(group)
                  else next.add(group)
                  return { ...before, [sceneKey]: [...next].sort() }
                })
              }
              onIsolate={() => {}}
              lens="structure"
              // Another question, another answer or another reader frames the map again.
              frameToken={`${sceneKey}|${JSON.stringify(view.values)}|${as ?? ''}|${view.factor}|${selected ?? ''}`}
            />
            {!panelOpen && <PanelOpener label="Answer panel" onOpen={() => setPanelOpen(true)} />}
          </div>
        </div>
        {panelOpen && (
          <PanelShell onClose={() => (selected ? select(scope, undefined) : setPanelOpen(false))}>
            {slice && projection && selected ? (
              <DataPanel
                domainId={domainId}
                lens="structure"
                model={slice}
                identities={identitySet}
                identity={as ?? ''}
                projection={projection}
                selected={selected}
                onSelect={(id) => select(scope, id)}
                onLight={() => {}}
                onIdentity={() => {}}
              />
            ) : (
              <Page domainId={domainId} data-ask-page={definition ? 'answer' : 'measure'}>
                {definition && shape && answer ? (
                  <AnswerPage
                    domainId={domainId}
                    bundle={bundle}
                    model={model}
                    definition={definition}
                    shape={shape}
                    slots={slots}
                    values={view.values}
                    picked={view.picked}
                    answer={answer}
                    {...(asLabel ? { asLabel } : {})}
                    approximate={approximate}
                    onSelect={(id) => select(scope, id)}
                    {...(writable ? { onChange: askChange } : {})}
                  />
                ) : definition ? (
                  <p className="text-[13px] text-muted-foreground">
                    Deciding what {asLabel ?? 'the identity'} may read of {origin}…
                  </p>
                ) : (
                  <MeasurePage
                    domainId={domainId}
                    model={model}
                    measure={measured}
                    factor={view.factor}
                    {...(measuredClass ? { selected: measuredClass } : {})}
                    starting={starting}
                    onSelect={(id) => select(scope, id)}
                    onQuery={(id) => open(scope, id)}
                    {...(writable ? { onNewQuery: askNewQuery } : {})}
                  />
                )}
              </Page>
            )}
          </PanelShell>
        )}
      </div>
    </div>
  )
}
