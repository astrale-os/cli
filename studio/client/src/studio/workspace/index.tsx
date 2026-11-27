/**
 * The Workspace level: the Domains of the workspace and of the registry, where each stands
 * against its Publications, what its dependencies still accept, and Publish.
 *
 * The map is the Studio's own Scene canvas, drawn from a pure projection of the versions
 * answers (`projectWorkspace`); the Index lists the same Scene, and the panel reads the selection
 * in sentences. Every fact keeps its own state: a registry that cannot be reached marks what it
 * could not answer and blanks nothing else.
 */

import {
  type DomainSummary,
  isReadOnlyDomainId,
  WORKSPACE_MAP_ID,
} from '@shared/contracts/workspace'
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { useUI } from '@/lib/store'
import { reportMissing } from '@/lib/use-address'

import type { Frame } from '../canvas/frame'

import { DOCK_CLEARANCE, TOOLBAR_CLEARANCE } from '../../schema-studio/palette'
import { PanelOpener, PanelShell } from '../../schema-studio/panel-shell'
import { SceneCanvas } from '../canvas/scene-canvas'
import { useCanvas } from '../canvas/store'
import { useLensPins } from '../canvas/use-lens-pins'
import { IndexRail } from '../index-rail/index-rail'
import { arrange, defaultCollapsed } from '../scene/arrange'
import { isolateScene } from '../scene/focus'
import { DependencyPage, OriginPage } from './dependency-page'
import { DomainPage } from './domain-page'
import { projectWorkspace, targetOf } from './project'
import { PublishDialog } from './publish-dialog'
import { useWorkspaceView } from './selection'
import { useWorkspaceFacts } from './use-facts'
import { WorkspacePage } from './workspace-page'

export interface WorkspaceLevelProps {
  domains: DomainSummary[]
  /** Read one workspace Domain at the Schema level. */
  onOpenDomain: (domainId: string) => void
  /** Read one Publication read-only at the Schema level. */
  onOpenPublished: (origin: string, version: string) => void
}

/** The map's one reading, as its layout record keys it. */
const MAP_LENS = 'map'
const SCOPE = `${WORKSPACE_MAP_ID}:${MAP_LENS}`
const NOTHING: ReadonlySet<string> = new Set()

export function WorkspaceLevel({ domains, onOpenDomain, onOpenPublished }: WorkspaceLevelProps) {
  // The Kernel is read-only and has no sources to publish: it appears as the Domain others depend on.
  const workspaceDomains = useMemo(
    () => domains.filter((domain) => !isReadOnlyDomainId(domain.id)),
    [domains],
  )

  const selected = useWorkspaceView((state) => state.selected)
  const reveal = useWorkspaceView((state) => state.reveal)
  const panelOpen = useWorkspaceView((state) => state.panelOpen)
  const everything = useWorkspaceView((state) => state.everything)
  const publishing = useWorkspaceView((state) => state.publishing)
  const select = useWorkspaceView((state) => state.select)
  const revealed = useWorkspaceView((state) => state.revealed)
  const setPanelOpen = useWorkspaceView((state) => state.setPanelOpen)
  const judgeEverything = useWorkspaceView((state) => state.judgeEverything)
  const openPublish = useWorkspaceView((state) => state.openPublish)

  const target = targetOf(selected)
  const facts = useWorkspaceFacts(workspaceDomains, target, everything)
  const scene = useMemo(() => projectWorkspace(facts.domains), [facts.domains])

  // A selection the map no longer draws — a Domain removed, a dependency dropped — is let go.
  const drawn = useMemo(
    () => new Set([...scene.nodes.map((node) => node.id), ...scene.links.map((link) => link.id)]),
    [scene],
  )
  const shownSelection = selected && drawn.has(selected) ? selected : undefined

  // A selection an address named is checked once the map draws everything it can: one it does
  // not draw lands on its Domain, else on nothing, and is said once. While the Workspace's own
  // reads fail, nothing can tell, and the selection stays as named.
  const arrived = useWorkspaceView((state) => state.arrived)
  const mapRead = facts.locals.status === 'ready' || workspaceDomains.length === 0
  useEffect(() => {
    if (!arrived) return
    if (facts.locals.status === 'error') return useWorkspaceView.getState().settleArrival()
    if (!mapRead) return
    if (!drawn.has(arrived)) {
      const named = targetOf(arrived)
      const owner = named && named.kind !== 'origin' ? `domain:${named.domainId}` : undefined
      const nearest = owner && drawn.has(owner) ? owner : undefined
      const originOf = (domainId: string) =>
        workspaceDomains.find((domain) => domain.id === domainId)?.origin ?? domainId
      const what = !named
        ? arrived
        : named.kind === 'domain'
          ? `Domain ${named.domainId}`
          : named.kind === 'origin'
            ? `Domain ${named.origin}`
            : `dependency “${named.alias}” of ${originOf(named.domainId)}`
      useWorkspaceView.getState().select(nearest)
      reportMissing(
        `The Workspace map draws no ${what}: ${nearest ? `${originOf(nearest.slice('domain:'.length))} is selected instead` : 'nothing is selected'}.`,
        { level: 'workspace' },
      )
    }
    useWorkspaceView.getState().settleArrival()
  }, [arrived, drawn, facts.locals.status, mapRead, workspaceDomains])

  // Where the reader placed cards and which groups they shut, kept like a Schema map's: in a
  // layout record, the scanned workspace's, so a reload and another browser find it again.
  const {
    pins,
    place,
    reset,
    collapsed: storedCollapsed,
    collapse,
  } = useLensPins(WORKSPACE_MAP_ID, MAP_LENS)
  const isolatedId = useCanvas((state) => state.isolated[SCOPE])
  const setIsolated = useCanvas((state) => state.setIsolated)
  const collapsed = useMemo(
    () => (storedCollapsed ? new Set(storedCollapsed) : defaultCollapsed(scene)),
    [scene, storedCollapsed],
  )
  const isolated = useMemo(
    () => (isolatedId ? isolateScene(scene, isolatedId) : null),
    [isolatedId, scene],
  )
  const shown = isolated ?? scene
  const arrangement = useMemo(
    () => arrange(shown, { collapsed: isolated ? NOTHING : collapsed }),
    [collapsed, isolated, shown],
  )

  const shownFrame = useRef<Frame | null>(null)
  const onFrame = useCallback((frame: Frame) => {
    shownFrame.current = frame
  }, [])
  const onPlace = useCallback(
    (next: typeof pins) => (isolated ? undefined : place(next)),
    [isolated, place],
  )
  const onAutoArrange = useCallback(() => {
    const before = reset()
    toast('The Workspace map is arranged automatically again', {
      action: { label: 'Undo', onClick: () => place(before) },
    })
  }, [place, reset])
  const onToggleGroup = useCallback(
    (group: string) => {
      const frame = shownFrame.current
      if (!isolated && frame && frame.arrangement === arrangement) place(frame.pins)
      const next = new Set(collapsed)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      collapse([...next], collapsed)
    },
    [arrangement, collapse, collapsed, isolated, place],
  )
  const onIsolate = useCallback((id: string | null) => setIsolated(SCOPE, id), [setIsolated])
  const onSelect = useCallback((id: string | undefined) => select(id), [select])
  const selectAndReveal = useCallback((id: string) => select(id, true), [select])

  const panelSide = useUI((state) => state.panelSide)
  const setNewDomainOpen = useUI((state) => state.setNewDomainOpen)
  const insets = useMemo(
    () => ({
      top: TOOLBAR_CLEARANCE,
      right: 0,
      bottom: panelSide === 'bottom' ? DOCK_CLEARANCE : 0,
      left: 0,
    }),
    [panelSide],
  )

  // Esc backs out of the selection; an open dialog or the canvas claims it first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (useWorkspaceView.getState().publishing) return
      select(undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [select])

  const others = useMemo(
    () =>
      scene.nodes
        .filter((node) => node.id.startsWith('origin:'))
        .map((node) => node.id.slice('origin:'.length)),
    [scene],
  )
  const shownTarget = targetOf(shownSelection)
  const domainOf = (domainId: string) =>
    facts.domains.find((domain) => domain.summary.id === domainId)

  let page: ReactNode
  if (shownTarget?.kind === 'domain' && domainOf(shownTarget.domainId)) {
    page = (
      <DomainPage
        domain={domainOf(shownTarget.domainId)!}
        domains={facts.domains}
        onOpenDomain={onOpenDomain}
        onSelect={selectAndReveal}
        onPublish={openPublish}
        refresh={facts.refresh}
      />
    )
  } else if (shownTarget?.kind === 'dependency' && domainOf(shownTarget.domainId)) {
    page = (
      <DependencyPage
        domain={domainOf(shownTarget.domainId)!}
        alias={shownTarget.alias}
        domains={facts.domains}
        onSelect={selectAndReveal}
        onOpenPublished={onOpenPublished}
        refresh={facts.refresh}
      />
    )
  } else if (shownTarget?.kind === 'origin') {
    page = (
      <OriginPage
        origin={shownTarget.origin}
        domains={facts.domains}
        onSelect={selectAndReveal}
        onOpenPublished={onOpenPublished}
        refresh={facts.refresh}
      />
    )
  } else {
    page = (
      <WorkspacePage
        domains={facts.domains}
        locals={facts.locals}
        others={others}
        judged={facts.judged}
        everything={everything}
        onJudgeEverything={judgeEverything}
        onSelect={selectAndReveal}
        onOpenPublished={onOpenPublished}
        onRereadLocals={facts.rereadLocals}
        onReadAgain={(domainIds) => Promise.all(domainIds.map((id) => facts.refresh(id)))}
        onNewDomain={() => setNewDomainOpen(true)}
      />
    )
  }

  const publishDomain = publishing ? domainOf(publishing) : undefined
  const reading = facts.locals.status === 'loading' && workspaceDomains.length > 0

  return (
    <div className="flex h-full flex-col" data-testid="workspace-level">
      <div className="flex min-h-0 flex-1">
        <IndexRail
          scene={shown}
          domainId={WORKSPACE_MAP_ID}
          selected={shownSelection}
          collapsed={isolated ? NOTHING : collapsed}
          onToggleGroup={onToggleGroup}
          onSelect={selectAndReveal}
          onClearSelection={() => select(undefined)}
        />
        <div className="relative min-w-0 flex-1">
          {reading ? (
            <div
              role="status"
              data-testid="scene-canvas-status"
              className="flex h-full flex-col items-center justify-center gap-1.5 bg-canvas text-muted-foreground"
            >
              <span>Reading the Workspace…</span>
            </div>
          ) : workspaceDomains.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 bg-canvas px-6 text-center">
              <p className="text-sm font-medium">This Workspace holds no Domain.</p>
              <p className="text-[13px] text-muted-foreground">
                The registry is still listed in the panel.
              </p>
            </div>
          ) : (
            <SceneCanvas
              key={WORKSPACE_MAP_ID}
              scene={shown}
              arrangement={arrangement}
              domainId={WORKSPACE_MAP_ID}
              selected={shownSelection}
              revealTarget={reveal}
              isolated={isolated ? isolatedId : undefined}
              insets={insets}
              pins={isolated ? new Map() : pins}
              onPlace={onPlace}
              onAutoArrange={pins.size > 0 && !isolated ? onAutoArrange : undefined}
              onFrame={onFrame}
              onSelect={onSelect}
              onRevealed={revealed}
              onToggleGroup={onToggleGroup}
              onIsolate={onIsolate}
            />
          )}
          {!panelOpen && <PanelOpener label="Workspace panel" onOpen={() => setPanelOpen(true)} />}
        </div>
        {panelOpen && (
          <PanelShell onClose={() => (shownSelection ? select(undefined) : setPanelOpen(false))}>
            {page}
          </PanelShell>
        )}
      </div>
      <PublishDialog
        domain={publishDomain}
        open={publishDomain !== undefined}
        onOpenChange={(open) => {
          if (!open) openPublish(undefined)
        }}
      />
    </div>
  )
}
