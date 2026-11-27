/**
 * One Domain read through the current lens: the Index, the Scene canvas and the Inspector.
 *
 * The lens projects the Domain's bundle into a Scene; the canvas and the Index both draw
 * that Scene and nothing else. The selection is the Studio's — ⌘K, reveal, comments and
 * the Inspector read and write the same `selectedClass` — so a lens never needs a
 * selection model of its own.
 *
 * Structure draws the other Domains as the reader chose on its canvas (`DomainsControl`): each
 * hidden, reached or whole, the choice kept in the lens's arrangement. A Domain drawn whole is
 * read as its own canvas reads it, and what it declares opens on its own page. Every other lens
 * reads the open Domain alone and lets go of a selection only a Domain drawn whole declares.
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { domainAddressOf } from '@shared/contracts/workspace'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ErrorBanner } from '@/components/error-banner'
import { api, qk, versionsApi, versionsKeys } from '@/lib/api'
import { bundleQueryOptions } from '@/lib/domain-queries'
import { useSchemaDomains } from '@/lib/hooks'
import { introspectionPhaseLabel } from '@/lib/introspection'
import { useUI } from '@/lib/store'
import { isModuleRef } from '@/lib/targets'

import type { Frame } from './canvas/frame'
import type { Pins } from './canvas/pins'

import { SchemaDetail } from '../schema-studio/detail/panel'
import { DomainsPanel } from '../schema-studio/domains-panel'
import { DOCK_CLEARANCE, TOOLBAR_CLEARANCE } from '../schema-studio/palette'
import { PanelShell } from '../schema-studio/panel-shell'
import { SchemaPolicyDetail } from '../schema-studio/policy-detail'
import { useWorkspaceDomainInputs } from '../schema-studio/workspace/use-domain-inputs'
import { DomainsControl, type DrawnAs } from './canvas/domains-control'
import { OPTION_GLYPHS } from './canvas/glyphs'
import { type CanvasOption, SceneCanvas } from './canvas/scene-canvas'
import { useCanvas } from './canvas/store'
import { useLensPins } from './canvas/use-lens-pins'
import { IndexRail } from './index-rail/index-rail'
import { BesidePage } from './inspector/beside'
import { lensOf, optionsOf, sceneOf } from './lenses'
import {
  domainChoices,
  namedOnlyBeside,
  type ReadableDomains,
  redraws,
  wholeDomainIds,
} from './lenses/composition'
import { isLensId } from './lenses/keys'
import { NO_COMPOSITION, type StructureComposition } from './lenses/structure'
import { spotlit, standIns } from './lenses/thread'
import { opensRulePage, ruleDetailOf, RulePage } from './rule-page'
import { arrange, arrangementKey, defaultCollapsed } from './scene/arrange'
import { isolateScene, openedBy } from './scene/focus'
import { withFoldsOpen } from './scene/rules'
import { domainName } from './workspace/words'

const NOTHING: ReadonlySet<string> = new Set()
const NO_PINS: Pins = new Map()

/**
 * What reading the Domains drawn whole gave, in their order: the bundles read, and whether each
 * read failed. Kept whole while nothing it holds changes, so a Domain still being read redraws
 * nothing.
 */
const readWhole = (results: readonly { data?: StudioSchemaBundle; isError: boolean }[]) => ({
  bundles: results.flatMap((result) => (result.data?.ir ? [result.data] : [])),
  failed: results.map(
    (result) => result.isError || (result.data !== undefined && result.data.ir === null),
  ),
})

/** `origin=share,…`: the shares a Structure draws, as a key that changes only when they do. */
const sharesKey = (shares: Readonly<Record<string, string>>, keep: (origin: string) => boolean) =>
  Object.entries(shares)
    .filter(([origin]) => keep(origin))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([origin, share]) => `${origin}=${share}`)
    .join(',')

const sharesOf = (key: string): Record<string, 'hidden' | 'whole'> =>
  Object.fromEntries(
    key
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const at = entry.lastIndexOf('=')
        return [entry.slice(0, at), entry.slice(at + 1) as 'hidden' | 'whole']
      }),
  )

/**
 * A Studio ref as the Scene names it. A relationship is selected and revealed as its Class
 * (`edge.X` and `class.X` are one thing); every other ref is already a Scene id.
 */
const sceneIdOf = (ref: string) =>
  ref.startsWith('edge.') ? `class.${ref.slice('edge.'.length)}` : ref

export function SchemaLevel({ domainId }: { domainId: string }) {
  const { data: domains } = useSchemaDomains()
  const ids = useMemo(() => [domainId], [domainId])
  const { inputs, pending, errors } = useWorkspaceDomainInputs(ids, domains)
  const input = inputs[0]

  const lensKey = useUI((state) => state.lens)
  const selectedClass = useUI((state) => state.selectedClass)
  const selectionDomainId = useUI((state) => state.selectionDomainId)
  const revealTarget = useUI((state) => state.revealTarget)
  const select = useUI((state) => state.selectClass)
  const setLens = useUI((state) => state.setLens)
  const clearSelection = useUI((state) => state.clearSelection)
  const setFocus = useUI((state) => state.setFocus)
  const panelOverlay = useUI((state) => state.panelOverlay)
  const setPanelOverlay = useUI((state) => state.setPanelOverlay)
  const revealOnCanvas = useUI((state) => state.revealOnCanvas)
  const panelSide = useUI((state) => state.panelSide)

  const lens = lensOf(lensKey)
  const scope = `${domainId}:${lens.id}`
  const setOptions = useCanvas((state) => state.options[lens.id])
  const setOption = useCanvas((state) => state.setOption)
  const isolatedId = useCanvas((state) => state.isolated[scope])
  const setIsolated = useCanvas((state) => state.setIsolated)
  const {
    ready: arrangementRead,
    pins: lensPins,
    place,
    reset,
    collapsed: storedCollapsed,
    collapse,
    opened: openFolds,
    toggleFold,
    shares,
    share,
  } = useLensPins(domainId, lens.id)
  // An isolated neighbourhood is laid out for the moment: what is placed in it lasts until
  // it is left, and the lens's own arrangement is never written.
  const [momentary, setMomentary] = useState<{ scope: string; id: string; pins: Pins }>()
  const shownFrame = useRef<Frame | null>(null)
  // The boxes as the scene at rest last stood, automatic or placed, and the reader's pins
  // that laid them: a focus lays its few new boxes in among them and moves none.
  const restPins = useRef<{ key: string; pins: Pins; laidWith: Pins } | null>(null)
  // The modules the reader shut while a selection had opened them: shut for that selection.
  const [shut, setShut] = useState<{ selection: string; groups: ReadonlySet<string> }>()

  // The selection belongs to one Domain; on another Domain's canvas nothing is selected.
  const ownSelection = selectionDomainId === domainId
  const selected = ownSelection && selectedClass ? sceneIdOf(selectedClass) : undefined
  const reveal =
    revealTarget && (ownSelection || !selectionDomainId) ? sceneIdOf(revealTarget) : null

  const options = useMemo(() => optionsOf(lens, setOptions), [lens, setOptions])
  const bundle = input?.bundle
  const anatomy = input?.anatomy

  // The other Domains, as this lens draws them: only a lens that composes draws any.
  const composes = lens.compose !== undefined
  const readable = useMemo<ReadableDomains>(() => {
    const workspace = new Map<string, string>()
    const outside = new Map<string, string>()
    for (const domain of domains ?? []) {
      if (!domain.origin) continue
      const kind = domainAddressOf(domain.id).kind
      if (kind === 'workspace') workspace.set(domain.origin, domain.id)
      else if (kind === 'kernel') outside.set(domain.origin, domain.id)
    }
    return { workspace, outside }
  }, [domains])
  const wholeIds = useMemo(
    () =>
      composes && bundle
        ? wholeDomainIds(domainChoices(bundle, readable, shares, NOTHING), readable)
        : [],
    [bundle, composes, readable, shares],
  )
  const whole = useQueries({ queries: wholeIds.map(bundleQueryOptions), combine: readWhole })
  const { data: locals } = useQuery({
    queryKey: versionsKeys.locals,
    queryFn: versionsApi.locals,
    enabled: composes,
  })
  const readOrigins = useMemo(
    () => new Set(whole.bundles.map((each) => each.ir!.domain)),
    [whole.bundles],
  )
  const failedOrigins = useMemo(() => {
    const originOf = new Map(
      [...readable.workspace, ...readable.outside].map(([origin, id]) => [id, origin]),
    )
    return new Set(
      wholeIds.flatMap((id, index) => (whole.failed[index] ? (originOf.get(id) ?? []) : [])),
    )
  }, [readable, whole.failed, wholeIds])
  const choices = useMemo(
    () =>
      composes && bundle ? domainChoices(bundle, readable, shares, readOrigins, failedOrigins) : [],
    [bundle, composes, failedOrigins, readOrigins, readable, shares],
  )
  // What is drawn changes only once a Domain drawn whole has been read: meanwhile it is reached.
  const drawnKey = sharesKey(shares, (origin) =>
    shares[origin] === 'hidden' ? true : readOrigins.has(origin),
  )
  const drawnShares = useMemo(() => sharesOf(drawnKey), [drawnKey])
  const composition = useMemo<StructureComposition>(() => {
    if (!composes || !bundle?.ir || Object.keys(drawnShares).length === 0) return NO_COMPOSITION
    const named = (origin: string, id: string) => {
      const version = locals?.find((local) => local.domainId === id)?.declared
      return { label: domainName(origin), ...(version ? { version } : {}) }
    }
    return {
      shares: drawnShares,
      whole: whole.bundles.map((each) => ({
        bundle: each,
        ...named(each.ir!.domain, each.domainId),
      })),
      home: named(bundle.ir.domain, domainId),
    }
  }, [bundle, composes, domainId, drawnShares, locals, whole.bundles])

  // The folds the reader opened are laid out open, at rest and under a focus alike.
  const atRest = useMemo(() => {
    if (!bundle?.ir) return undefined
    const projected = sceneOf(lens, bundle, options, undefined, anatomy, composition)
    return projected ? withFoldsOpen(projected, openFolds) : undefined
  }, [anatomy, bundle, composition, lens, openFolds, options])
  // What of the selection the lens draws more of: a function's mutations, in Behavior.
  const focus = bundle && lens.focus ? lens.focus(bundle, options, selected) : undefined
  const scene = useMemo(() => {
    if (!bundle || !focus) return atRest
    const projected = sceneOf(lens, bundle, options, focus, anatomy, composition)
    return projected ? withFoldsOpen(projected, openFolds) : atRest
  }, [anatomy, atRest, bundle, composition, focus, lens, openFolds, options])
  // Modules open or collapse as the reader leaves them, at rest; a focus never changes that.
  const collapsed = useMemo(
    () =>
      storedCollapsed ? new Set(storedCollapsed) : atRest ? defaultCollapsed(atRest) : NOTHING,
    [atRest, storedCollapsed],
  )
  const isolated = useMemo(
    () => (scene && isolatedId ? isolateScene(scene, isolatedId) : null),
    [isolatedId, scene],
  )
  const shown = isolated ?? scene
  const isolatedKey = isolated ? isolatedId : undefined
  // A selection opens, while it lasts, the collapsed modules holding what its lines reach, so
  // every line it lights leaves a row that shows. One the reader shuts stays shut for it.
  const selection = `${scope}|${selected ?? ''}`
  const opening = useMemo(() => {
    if (!scene || isolated || !selected) return NOTHING
    const closed = shut?.selection === selection ? shut.groups : NOTHING
    const opened = [...openedBy(scene, selected)].filter(
      (group) => collapsed.has(group) && !closed.has(group),
    )
    return opened.length > 0 ? new Set(opened) : NOTHING
  }, [collapsed, isolated, scene, selected, selection, shut])
  const restArrangementKey = atRest ? arrangementKey(atRest, collapsed) : undefined
  const focusPins = useMemo(() => {
    const rest = restPins.current
    // Once the reader places or rearranges anything, their pins say where everything is.
    return (focus || opening.size > 0) &&
      rest &&
      rest.key === restArrangementKey &&
      rest.laidWith === lensPins
      ? rest.pins
      : lensPins
  }, [focus, lensPins, opening, restArrangementKey])
  const pins = isolatedKey
    ? momentary?.scope === scope && momentary.id === isolatedKey
      ? momentary.pins
      : NO_PINS
    : focusPins
  // An isolated neighbourhood is small by construction: every module in it is open.
  const arrangement = useMemo(() => {
    if (!shown) return undefined
    if (isolated) return arrange(shown, { collapsed: NOTHING })
    const open =
      opening.size > 0 ? new Set([...collapsed].filter((id) => !opening.has(id))) : collapsed
    return arrange(shown, { collapsed: open })
  }, [collapsed, isolated, opening, shown])

  const lights = useMemo(
    () => (bundle && shown ? standIns(bundle, shown, selected) : undefined),
    [bundle, selected, shown],
  )
  // What the Index filter keeps, read through this lens: the rest steps back on the canvas.
  const [filtered, setFiltered] = useState<readonly string[] | null>(null)
  const filterIds = useMemo(
    () => (bundle && shown && filtered ? spotlit(bundle, shown, filtered) : undefined),
    [bundle, filtered, shown],
  )
  // What a panel points at (`useCanvas.spotlight`), read through this lens.
  const spotlight = useCanvas((state) => state.spotlight)
  const spotlightIds = useMemo(
    () =>
      bundle && shown && spotlight?.domainId === domainId
        ? spotlit(bundle, shown, spotlight.ids)
        : undefined,
    [bundle, domainId, shown, spotlight],
  )

  const onSelect = useCallback(
    (id: string | undefined) => (id ? select(id, domainId) : clearSelection()),
    [clearSelection, domainId, select],
  )
  const onRevealed = useCallback(() => revealOnCanvas(null), [revealOnCanvas])
  const onToggleGroup = useCallback(
    (group: string) => {
      // A module the selection opened shuts for the selection and leaves the reader's own.
      if (opening.has(group)) {
        const closed = shut?.selection === selection ? shut.groups : NOTHING
        setShut({ selection, groups: new Set([...closed, group]) })
        return
      }
      // Opening or closing a module keeps every other box where the reader sees it.
      const frame = shownFrame.current
      if (!isolated && frame && frame.arrangement.key === arrangement?.key) place(frame.pins)
      const next = new Set(collapsed)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      collapse([...next], collapsed)
    },
    [arrangement, collapse, collapsed, isolated, opening, place, selection, shut],
  )
  const onToggleFold = useCallback(
    (fold: string) => {
      // Opening or shutting a fold keeps every other box where the reader sees it; the boxes
      // below the card make room for it.
      const frame = shownFrame.current
      if (!isolated && frame && frame.arrangement.key === arrangement?.key) place(frame.pins)
      toggleFold(fold)
    },
    [arrangement, isolated, place, toggleFold],
  )
  const onFrame = useCallback(
    (frame: Frame) => {
      shownFrame.current = frame
      if (frame.arrangement.key === restArrangementKey)
        restPins.current = {
          key: frame.arrangement.key,
          pins: frame.pins,
          laidWith: frame.laidWith,
        }
    },
    [restArrangementKey],
  )
  const onPlace = useCallback(
    (next: Pins) => {
      if (!isolatedKey) return place(next)
      setMomentary((current) => ({
        scope,
        id: isolatedKey,
        pins: new Map([
          ...(current?.scope === scope && current.id === isolatedKey ? current.pins : []),
          ...next,
        ]),
      }))
    },
    [isolatedKey, place, scope],
  )
  const onAutoArrange = useCallback(() => {
    if (isolatedKey) return setMomentary(undefined)
    const before = reset()
    toast(`${lens.label} is arranged automatically again`, {
      action: { label: 'Undo', onClick: () => place(before) },
    })
  }, [isolatedKey, lens.label, place, reset])
  const onIsolate = useCallback((id: string | null) => setIsolated(scope, id), [scope, setIsolated])
  const onLens = useCallback(
    (id: string) => {
      if (isLensId(id)) setLens(id)
    },
    [setLens],
  )
  // Groups the Index lists but the canvas never draws (`Scene.index`) open and shut in the
  // Index alone: the lens's stored modules are the canvas's.
  const [shutIndex, setShutIndex] = useState<ReadonlySet<string>>(NOTHING)
  const listsOwn = atRest?.index !== undefined
  const onIndexToggle = useCallback(
    (group: string) => {
      if (!listsOwn) return onToggleGroup(group)
      setShutIndex((shut) => {
        const next = new Set(shut)
        if (next.has(group)) next.delete(group)
        else next.add(group)
        return next
      })
    },
    [listsOwn, onToggleGroup],
  )
  const onIndexSelect = useCallback(
    (id: string) => {
      select(id, domainId)
      revealOnCanvas(id)
    },
    [domainId, revealOnCanvas, select],
  )

  const canvasOptions = useMemo<CanvasOption[]>(
    () =>
      lens.options.map((option) => {
        const Icon = OPTION_GLYPHS[option.icon]
        return {
          id: option.id,
          label: option.label,
          description: option.description,
          value: options[option.id] === true,
          icon: <Icon />,
        }
      }),
    [lens, options],
  )
  const onOption = useCallback(
    (id: string, value: boolean) => setOption(lens.id, id, value),
    [lens.id, setOption],
  )
  // The width a floating panel lies over the canvas: fit and reveal frame what it leaves, so a
  // selection is never drawn under the panel that describes it.
  const [covered, setCovered] = useState(0)
  const insets = useMemo(
    () => ({
      top: TOOLBAR_CLEARANCE,
      right: covered,
      bottom: panelSide === 'bottom' ? DOCK_CLEARANCE : 0,
      left: 0,
    }),
    [covered, panelSide],
  )

  // Esc backs out: the canvas leaves an isolated neighbourhood first (and claims the key);
  // otherwise the selection and any open panel close.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setFocus(null)
      select(undefined)
      setPanelOverlay(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [select, setFocus, setPanelOverlay])

  // Leaving Structure lets go of a selection only a Domain drawn whole declares: every other
  // lens reads the open Domain alone, which names nothing for it.
  useEffect(() => {
    if (composes || !ownSelection || !selectedClass || !bundle?.ir) return
    if (namedOnlyBeside(bundle, selectedClass)) clearSelection()
  }, [bundle, clearSelection, composes, ownSelection, selectedClass])

  const homeLabel = bundle?.ir ? domainName(bundle.ir.domain) : ''
  const homeVersion = locals?.find((local) => local.domainId === domainId)?.declared ?? undefined
  const onChoose = useCallback(
    (origin: string, drawn: DrawnAs, redrawn: () => void) => {
      const before = choices.find((choice) => choice.origin === origin)?.drawn ?? 'reached'
      // A choice that changes what is drawn frames the new canvas whole, as an option does.
      if (bundle && redraws(bundle, origin, before, drawn)) redrawn()
      share(origin, drawn)
    },
    [bundle, choices, share],
  )
  const lensControls = useMemo(
    () =>
      composes && bundle?.ir
        ? (redrawn: () => void) => (
            <DomainsControl
              home={{ label: homeLabel, ...(homeVersion ? { version: homeVersion } : {}) }}
              choices={choices}
              onChoose={(origin, drawn) => onChoose(origin, drawn, redrawn)}
            />
          )
        : undefined,
    [bundle, choices, composes, homeLabel, homeVersion, onChoose],
  )

  const { data: introspection } = useQuery({
    queryKey: qk.introspection,
    queryFn: api.introspection,
    enabled: pending,
    staleTime: 0,
    refetchInterval: pending ? 500 : false,
  })
  const summary = domains?.find((domain) => domain.id === domainId)
  const timing = introspection?.domains.find((entry) => entry.domainId === domainId)

  const overlayInput = inputs.find((candidate) => candidate.summary.id === panelOverlay?.domainId)
  const selectionInput = ownSelection ? input : undefined
  // A module groups members; selecting one lights its region, and there is nothing to inspect.
  const detail =
    ownSelection && selectedClass && !isModuleRef(selectedClass) ? selectedClass : undefined
  // A rule opens its own page under Rules; under a lens that draws none, what it sits on. A
  // form of constraint and the Domain functions card sit on nothing: they keep their page.
  const rulePage =
    detail !== undefined && opensRulePage(detail) && (lens.id === 'rules' || !detail.includes('#'))
  // What a Domain drawn whole declares opens on that Domain's own page, read as it reads it.
  const beside = useMemo(() => {
    if (!composes || !detail || !atRest?.areas || !bundle?.ir) return undefined
    const id = sceneIdOf(detail)
    const item =
      atRest.nodes.find((node) => node.id === id) ?? atRest.links.find((link) => link.id === id)
    if (!item?.anchor || !item.anchorDomain || item.anchorDomain === domainId) return undefined
    const read = whole.bundles.find((each) => each.domainId === item.anchorDomain)
    const area = atRest.areas.find((each) => each.domainId === item.anchorDomain)
    if (!read || !area) return undefined
    return {
      bundle: read,
      anchor: item.anchor,
      label: area.label,
      canvas: { domainId, origin: bundle.ir.domain, label: homeLabel, scene: atRest },
    }
  }, [atRest, bundle, composes, detail, domainId, homeLabel, whole.bundles])

  return (
    <div className="flex h-full flex-col" data-testid="schema-level" data-lens={lens.id}>
      <ErrorBanner messages={[...errors, ...(bundle?.error ? [bundle.error.message] : [])]} />
      <div className="flex min-h-0 flex-1">
        <IndexRail
          // The Index lists what the lens draws at rest: the boxes a focus adds come and go
          // with the selection and never reflow it.
          scene={isolated ?? atRest}
          domainId={domainId}
          selected={selected}
          collapsed={listsOwn ? shutIndex : isolated ? NOTHING : collapsed}
          onToggleGroup={onIndexToggle}
          onSelect={onIndexSelect}
          onClearSelection={clearSelection}
          onFilter={setFiltered}
        />

        <div className="relative min-w-0 flex-1">
          {!lens.project ? (
            <LensComing label={lens.label} question={lens.question} />
          ) : !input || !bundle ? (
            errors.length > 0 ? null : (
              <CanvasStatus
                title="Introspecting schema…"
                detail={
                  summary ? `${summary.origin} · ${introspectionPhaseLabel(timing)}` : undefined
                }
              />
            )
          ) : !bundle.ir ? (
            <CanvasStatus title="No compiled schema available." />
          ) : !arrangementRead ? null : scene && arrangement && shown ? (
            // The canvas waits for the lens's arrangement: its first frame shows what the
            // reader placed where they placed it, and its first fit frames that.
            <SceneCanvas
              key={domainId}
              scene={shown}
              arrangement={arrangement}
              domainId={domainId}
              selected={selected}
              lights={lights}
              spotlight={spotlightIds}
              filter={filterIds}
              revealTarget={reveal}
              isolated={isolated ? isolatedId : undefined}
              insets={insets}
              options={canvasOptions}
              onOption={onOption}
              lensControls={lensControls}
              pins={pins}
              onPlace={onPlace}
              onAutoArrange={pins.size > 0 ? onAutoArrange : undefined}
              onFrame={onFrame}
              onSelect={onSelect}
              onRevealed={onRevealed}
              onToggleGroup={onToggleGroup}
              onToggleFold={onToggleFold}
              onIsolate={onIsolate}
              onLens={onLens}
              frameToken={`${lens.id}|${selected ?? ''}`}
              lens={lens.id}
            />
          ) : null}
        </div>

        {panelOverlay?.kind === 'domains' && overlayInput ? (
          <PanelShell onCover={setCovered} onClose={() => setPanelOverlay(null)}>
            <DomainsPanel domainId={overlayInput.summary.id} />
          </PanelShell>
        ) : detail?.startsWith('policy.') ? (
          <PanelShell onCover={setCovered} onClose={() => select(undefined)}>
            <SchemaPolicyDetail domainId={domainId} policyKey={detail.slice('policy.'.length)} />
          </PanelShell>
        ) : beside ? (
          <PanelShell onCover={setCovered} onClose={() => select(undefined)}>
            <BesidePage {...beside} />
          </PanelShell>
        ) : rulePage && detail && selectionInput ? (
          <PanelShell onCover={setCovered} onClose={() => select(undefined)}>
            <RulePage bundle={selectionInput.bundle} selected={detail} />
          </PanelShell>
        ) : detail && selectionInput ? (
          <PanelShell onCover={setCovered} onClose={() => select(undefined)}>
            <SchemaDetail bundle={selectionInput.bundle} selected={ruleDetailOf(detail)} />
          </PanelShell>
        ) : null}
      </div>
    </div>
  )
}

/** Loading and empty states belong to the canvas: the Index and the Studio stay usable. */
function CanvasStatus({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      role="status"
      data-testid="scene-canvas-status"
      className="flex h-full flex-col items-center justify-center gap-1.5 bg-canvas text-muted-foreground"
    >
      <span>{title}</span>
      {detail && <span className="text-xs">{detail}</span>}
    </div>
  )
}

/** A lens named in the switch whose projector is not written yet. */
function LensComing({ label, question }: { label: string; question: string }) {
  return (
    <div
      data-testid="lens-coming"
      className="flex h-full flex-col items-center justify-center gap-1 bg-canvas px-6 text-center"
    >
      <p className="text-sm font-medium">{label}</p>
      <p className="text-[13px] text-muted-foreground">{question} — this lens is coming.</p>
    </div>
  )
}
