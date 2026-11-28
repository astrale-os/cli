import type { PublicationAddress } from '@shared/contracts/versions'
import type { DomainSummary } from '@shared/contracts/workspace'

import {
  publicationOf,
  publishedDomainId,
  REGISTRY_READ_LIMIT_MS,
} from '@shared/contracts/versions'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Lock,
  type LucideIcon,
  MessagesSquare,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings,
} from 'lucide-react'
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { WorkspaceLevelProps } from '@/studio/workspace'

import { AgentSubmitButton } from '@/components/agent-activity'
import { AskLayer } from '@/components/ask-popover'
import { CommandPalette } from '@/components/command-palette'
import { CommentDraftPopover } from '@/components/comment-draft-popover'
import { CommentModeOverlay } from '@/components/comment-mode'
import { NewDomainDialog } from '@/components/create-domain'
import { SettingsDialog } from '@/components/settings/dialog'
import { StudioRuntimeNotice } from '@/components/studio-runtime-notice'
import { Tour } from '@/components/tour'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { WorkPanel } from '@/components/work-panel'
import { useAgentLive, useAgentSnapshot } from '@/lib/agent'
import { api } from '@/lib/api'
import {
  bundleQueryOptions,
  invalidateRefreshed,
  readPublicationAgain,
  remoteFailureOf,
} from '@/lib/domain-queries'
import { useDatasets, useWorkspace } from '@/lib/hooks'
import { OnScreen, useOnScreen } from '@/lib/notices'
import { shownDomainId, useUI } from '@/lib/store'
import { useStudioEventSync } from '@/lib/studio-events'
import { useAddress } from '@/lib/use-address'
import { cn } from '@/lib/utils'
import { useWorkspaceUiSync } from '@/lib/workspace-ui'
import { LevelBreadcrumb } from '@/studio/bar/level-breadcrumb'
import { LEVEL_SHORTCUTS, LevelSwitch } from '@/studio/bar/level-switch'
import { GLYPHS } from '@/studio/canvas/glyphs'
import { openChosenDataset, switchToData } from '@/studio/data/entry'
import { loadDataLevel } from '@/studio/data/load'
import { datasetName } from '@/studio/data/model'
import { DataWait } from '@/studio/data/wait'
import {
  dataLensOf,
  LENS_NAMES,
  type LensId,
  type LensKey,
  lensReadable,
} from '@/studio/lenses/keys'
import { Reading, RemoteNotice } from '@/studio/workspace/remote'

const LazySchemaLevel = lazy(() =>
  import('./studio/schema-level').then(({ SchemaLevel }) => ({ default: SchemaLevel })),
)
const LazyDataLevel = lazy(() => loadDataLevel().then(({ DataLevel }) => ({ default: DataLevel })))
const LazyDatasetsPage = lazy(() =>
  loadDataLevel().then(({ DatasetsPage }) => ({ default: DatasetsPage })),
)
const LazyWorkspaceLevel = lazy(() =>
  import('./studio/workspace/index').then(({ WorkspaceLevel }) => ({ default: WorkspaceLevel })),
)

/** The Workspace level: every Domain, none of them read through a lens. */
function WorkspaceRouter(props: WorkspaceLevelProps) {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-muted-foreground">
          Loading workspace…
        </div>
      }
    >
      <LazyWorkspaceLevel {...props} />
      <OnScreen place={{ level: 'workspace' }} />
    </Suspense>
  )
}

/** The Schema level: one Domain read through the lens. */
function SchemaRouter({ domainId }: { domainId: string }) {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-muted-foreground">
          Loading schema studio…
        </div>
      }
    >
      <LazySchemaLevel domainId={domainId} />
      <SchemaOnScreen domainId={domainId} />
    </Suspense>
  )
}

/** The Schema level is on screen once its code is in and its bundle has answered. */
function SchemaOnScreen({ domainId }: { domainId: string }) {
  const bundle = useQuery({ ...bundleQueryOptions(domainId), enabled: false })
  useOnScreen(bundle.isPending ? undefined : { level: 'domain', domainId })
  return null
}

/**
 * When the reader asked for the Data level of a Domain, for its Datasets page, or for another
 * dataset of it: the one clock its wait is said on.
 */
function useAskedAt(domainId: string, datasetPath: string | null): number {
  const [asked, setAsked] = useState(() => ({ domainId, datasetPath, at: Date.now() }))
  if (asked.domainId === domainId && asked.datasetPath === datasetPath) return asked.at
  const next = { domainId, datasetPath, at: Date.now() }
  setAsked(next)
  return next.at
}

/**
 * The Data level: one dataset of the Domain, named by its module, read through the lens. Named
 * or not, it mounts: a dataset that cannot be read says where and why.
 * Opened on no dataset, it is the Domain's Datasets page: each dataset it references, to open.
 * Switched to before the Domain's datasets are read, it waits on them, then opens the dataset
 * `openChosenDataset` chooses.
 * The level's code, the Domain's datasets and its Schema are asked for at once, none waiting on
 * another; until they answer, the wait says which dataset opens and what is being read.
 */
function DataRouter({
  domainId,
  origin,
  lens,
}: {
  domainId: string
  origin: string
  lens: LensKey
}) {
  const queryClient = useQueryClient()
  const datasetPath = useUI((s) => s.dataset)
  const choosing = useUI((s) => s.choosingDataset)
  const { data, isError } = useDatasets(domainId)
  const since = useAskedAt(domainId, datasetPath)
  useEffect(() => {
    void loadDataLevel()
    void queryClient.prefetchQuery(bundleQueryOptions(domainId))
  }, [domainId, queryClient])
  useEffect(() => {
    if (choosing && (data || isError)) openChosenDataset(domainId, data?.datasets)
  }, [choosing, data, domainId, isError])
  if (choosing)
    return (
      <DataWait
        since={since}
        dataset={`the data of ${origin}`}
        reading={`Reading the datasets ${origin} declares`}
      />
    )
  if (datasetPath === null)
    return (
      <Suspense
        fallback={
          <DataWait
            since={since}
            dataset={`the datasets of ${origin}`}
            reading="Loading the Data level"
          />
        }
      >
        <LazyDatasetsPage domainId={domainId} origin={origin} since={since} />
      </Suspense>
    )
  return (
    <Suspense
      fallback={
        <DataWait
          since={since}
          dataset={datasetName(data?.datasets, datasetPath)}
          reading="Loading the Data level"
        />
      }
    >
      <LazyDataLevel
        domainId={domainId}
        origin={origin}
        datasetPath={datasetPath}
        lens={lens}
        since={since}
      />
    </Suspense>
  )
}

/** What a lens can read of a published Schema, and what it cannot, where it differs from the rest. */
const PUBLISHED_READS: Partial<Record<LensId, string>> = {
  behavior:
    'Behavior reads the published Schema: every function and Method, where it is declared, and the Classes its signature names. What a function reads, writes and calls is read from its handler source, which a published bundle does not hold: the map draws what each declaration names, and none of its effects.',
  views:
    'Views reads the published Schema: every View it declares. A published bundle holds no View code, so none of them opens here.',
}

/**
 * A Publication at the Schema level. The registry answers first: while it is read, and when it
 * does not give the Publication, the page says which — never a blank canvas. Once read, the
 * Schema level draws it as it draws any Domain, under a line that says it is a Publication and
 * what a published bundle does not carry.
 */
function PublicationRouter({
  domainId,
  publication,
  lens,
}: {
  domainId: string
  publication: PublicationAddress
  lens: LensId
}) {
  const queryClient = useQueryClient()
  const openWorkspace = useUI((s) => s.openWorkspace)
  const bundle = useQuery(bundleQueryOptions(domainId))
  const what = `${publication.origin} ${publication.version}`
  if (bundle.isPending)
    return (
      <div
        data-publication-status="reading"
        className="mx-auto flex h-full max-w-xl items-center justify-center px-6"
      >
        <Reading
          limitMs={REGISTRY_READ_LIMIT_MS}
          what={`Publication ${what}`}
          onRetry={() => readPublicationAgain(queryClient, domainId)}
          skeleton={false}
        >
          Reading {what} from the registry…
        </Reading>
      </div>
    )
  if (bundle.isError) {
    const failure = remoteFailureOf(bundle.error) ?? {
      status: 'failed' as const,
      message: String(bundle.error),
    }
    return (
      <div className="h-full overflow-auto bg-canvas" data-publication-status={failure.status}>
        <OnScreen place={{ level: 'domain', domainId }} />
        <div className="mx-auto max-w-xl space-y-3 px-6 py-16">
          <p className="text-sm font-medium">Publication {what}, read-only, could not be read.</p>
          <RemoteNotice
            failure={failure}
            what={what}
            onRetry={() => readPublicationAgain(queryClient, domainId)}
          />
          <button
            type="button"
            onClick={openWorkspace}
            className="text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Back to the Workspace
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <p
        data-publication-notice={lens}
        className="shrink-0 border-b bg-muted/40 px-3 py-1.5 text-[12.5px] leading-relaxed text-muted-foreground"
      >
        <span className="font-medium text-foreground">Publication {what}, read-only.</span>{' '}
        {PUBLISHED_READS[lens] ??
          'Its Schema is the one the registry serves: no sources, datasets or View code come with it, and nothing here writes to it.'}
      </p>
      <div className="relative min-h-0 flex-1">
        <SchemaRouter domainId={domainId} />
      </div>
    </div>
  )
}

/** The Data level, asked of a Publication: a published bundle carries no dataset. */
function PublicationWithoutData({
  domainId,
  publication,
}: {
  domainId: string
  publication: PublicationAddress
}) {
  const openSchema = useUI((s) => s.openSchema)
  useOnScreen({ level: 'data', domainId })
  return (
    <div
      data-publication-status="no-datasets"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground"
    >
      <p>
        Publication {publication.origin} {publication.version} carries no dataset: datasets are read
        from a Domain's sources, and a published bundle holds its Schema alone.
      </p>
      <button
        type="button"
        onClick={openSchema}
        className="inline-flex h-8 items-center rounded-md border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        Read its Schema
      </button>
    </div>
  )
}

/** Each lens by the glyph of what it draws: a graph, a function, a Policy, a View. */
const LENS_ICONS: Record<LensId, LucideIcon> = {
  structure: Network,
  behavior: GLYPHS.function,
  rules: GLYPHS.policy,
  views: GLYPHS.view,
}

const LENS_TAB =
  'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors max-xl:px-2 disabled:cursor-default disabled:text-muted-foreground/55'

/** Below this width a tab other than the current one shows its glyph alone; its name stays its accessible name. */
const LENS_LABEL_NARROW = 'max-[1400px]:sr-only'

/**
 * The lens switch: which question the canvas answers about the Domain. A lens a level does not
 * read is its glyph alone, disabled, its tooltip saying why; the Data level reads Rules before
 * the Schema does, and never a lens only the Schema answers. Scenarios keep their place after
 * the lenses, locked. On a narrow window every tab but the current one is its glyph alone.
 */
function LensSwitch({
  active,
  dataLevel,
  onChange,
}: {
  active: LensId
  dataLevel: boolean
  onChange: (lens: LensId) => void
}) {
  return (
    <nav
      aria-label="Lens"
      data-testid="lens-switch"
      data-tour="lenses"
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {LENS_NAMES.map((lens) => {
        const current = lens.id === active
        const readable = lensReadable(lens, dataLevel)
        const Icon = LENS_ICONS[lens.id]
        return (
          <Tooltip key={lens.id}>
            <TooltipTrigger asChild>
              {/* A disabled button gets no pointer events, so its tooltip hangs off a wrapper. */}
              <span className="inline-flex">
                <button
                  type="button"
                  aria-pressed={current}
                  disabled={!readable}
                  data-lens={lens.id}
                  onClick={() => onChange(lens.id)}
                  className={cn(
                    LENS_TAB,
                    current
                      ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className={!readable ? 'sr-only' : current ? undefined : LENS_LABEL_NARROW}>
                    {lens.label}
                  </span>
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-72">
              {readable ? (
                <>
                  {lens.question}
                  <span className="ml-1.5 text-muted-foreground">{lens.shortcut}</span>
                </>
              ) : (
                <span data-lens-reason={lens.id}>
                  {(dataLevel && lens.schemaOnly) || `${lens.label} is not read yet.`}
                </span>
              )}
            </TooltipContent>
          </Tooltip>
        )
      })}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <button type="button" disabled data-lens="scenarios" className={LENS_TAB}>
              <GLYPHS.scenario className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className={LENS_LABEL_NARROW}>Scenarios</span>
              <Lock className="h-3 w-3 shrink-0" aria-label="locked" />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          What a sequence of calls does to a Dataset
          <span className="ml-1.5 text-muted-foreground">locked</span>
        </TooltipContent>
      </Tooltip>
    </nav>
  )
}

/** A header action: icon only, its name and shortcut in the tooltip. */
function IconAction({
  label,
  shortcut,
  tour,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  /** The tour's handle on this action — see `components/tour.tsx`. */
  tour?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          data-tour={tour}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-60',
            active
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut && <span className="ml-1.5 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

export function App() {
  const queryClient = useQueryClient()
  const { data: domains } = useWorkspace()
  const workspaceUiReady = useWorkspaceUiSync()
  const level = useUI((s) => s.level)
  const sectionDomainId = useUI((s) => s.readerDomainId)
  const selectionDomainId = useUI((s) => s.selectionDomainId)
  const setSectionDomainId = useUI((s) => s.setReaderDomain)
  const setPaletteOpen = useUI((s) => s.setPaletteOpen)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const commentMode = useUI((s) => s.commentMode)
  const panelOpen = useUI((s) => s.panelOpen)
  const panelSide = useUI((s) => s.panelSide)
  const toggleCommentMode = useUI((s) => s.toggleCommentMode)
  const toggleAskMode = useUI((s) => s.toggleAskMode)
  const clearSelection = useUI((s) => s.clearSelection)
  const openDomain = useUI((s) => s.openDomain)
  const lens = useUI((s) => s.lens)
  const setLens = useUI((s) => s.setLens)
  const setRun = useAgentLive((s) => s.setRun)
  const validIds = useMemo(() => new Set((domains ?? []).map((domain) => domain.id)), [domains])
  const scopedDomainId = shownDomainId(
    { readerDomainId: sectionDomainId, selectionDomainId },
    domains ?? [],
  )
  const publication =
    level !== 'workspace' && scopedDomainId ? publicationOf(scopedDomainId) : undefined
  const arrived = useAddress({ ready: workspaceUiReady, domains })
  const openPublished = useCallback(
    (origin: string, version: string) => openDomain(publishedDomainId(origin, version)),
    [openDomain],
  )
  const refreshDomains = useMutation({
    mutationFn: api.refreshWorkspace,
    onSuccess: ({ refreshed }) => {
      invalidateRefreshed(
        queryClient,
        (domains ?? []).map((domain) => domain.id),
      )
      toast.success(`${refreshed === 1 ? 'Domain' : 'Domains'} refreshed`)
    },
    onError: (error) => toast.error(`Could not refresh domains — ${String(error)}`),
  })

  // A concrete canvas selection hands its owner to the local readers. Their picker
  // can then diverge without creating a workspace-wide active-domain concept.
  useEffect(() => {
    if (selectionDomainId && validIds.has(selectionDomainId)) setSectionDomainId(selectionDomainId)
  }, [selectionDomainId, validIds, setSectionDomainId])

  const changeSectionDomain = (domainId: string) => {
    setSectionDomainId(domainId)
    clearSelection()
  }

  useStudioEventSync()

  // keep the merge-forward agent store in sync with the authoritative snapshot —
  // recovers the terminal run state if an `agent-run` frame was ever missed.
  const { data: agentSnap } = useAgentSnapshot()
  useEffect(() => {
    if (agentSnap?.run) setRun(agentSnap.run)
  }, [agentSnap, setRun])

  // global hotkeys, all ignored while typing: C toggles comment mode, A toggles ask mode, S and D
  // switch a Domain to its Schema and its Data, a digit switches lens
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const lens = LENS_NAMES.find((name) => name.shortcut === e.key)
      const key = e.key.toUpperCase()
      const ui = useUI.getState()
      if (key === 'C') {
        e.preventDefault()
        toggleCommentMode()
      } else if (key === 'A') {
        e.preventDefault()
        toggleAskMode()
      } else if (key === LEVEL_SHORTCUTS.schema && ui.level === 'data') {
        e.preventDefault()
        ui.openSchema()
      } else if (key === LEVEL_SHORTCUTS.data && ui.level === 'domain') {
        // a Publication carries no dataset
        const shown = shownDomainId(ui, domains ?? [])
        if (!shown || publicationOf(shown)) return
        e.preventDefault()
        switchToData(shown)
      } else if (lens && ui.level !== 'workspace') {
        // a lens reads one Domain: at the Workspace level its key does nothing
        if (!lensReadable(lens, useUI.getState().level === 'data')) return
        e.preventDefault()
        setLens(lens.id)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [domains, toggleCommentMode, toggleAskMode, setLens])

  if (!domains || !workspaceUiReady || !arrived) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Connecting to studio…
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
          {/* where you are */}
          <div className="flex min-w-0 flex-1 items-center">
            <LevelBreadcrumb
              domains={domains}
              domainId={scopedDomainId}
              onDomainChange={changeSectionDomain}
            />
          </div>

          {/* what you ask — of a Domain: the Workspace level has no lens */}
          {level !== 'workspace' && (
            <LensSwitch active={lens} dataLevel={level === 'data'} onChange={setLens} />
          )}

          {/* what you can do: on a narrow window, as wide as its controls, and no wider */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 max-lg:flex-none">
            <StudioRuntimeNotice />
            {level !== 'workspace' && scopedDomainId && (
              <>
                <LevelSwitch
                  domain={{
                    id: scopedDomainId,
                    origin: publication?.origin ?? originOf(domains, scopedDomainId),
                  }}
                  dataLevel={level === 'data'}
                  publication={publication !== undefined}
                />
                <span className="mx-1 h-4 w-px bg-border" />
              </>
            )}
            <IconAction
              label="Refresh domains"
              disabled={refreshDomains.isPending}
              onClick={() => refreshDomains.mutate()}
            >
              <RefreshCw className={cn('h-4 w-4', refreshDomains.isPending && 'animate-spin')} />
            </IconAction>
            <IconAction label="Search" shortcut="⌘K" onClick={() => setPaletteOpen(true)}>
              <Search className="h-4 w-4" />
            </IconAction>
            <IconAction
              label="Comment mode"
              shortcut="C"
              tour="comment"
              active={commentMode}
              onClick={() => toggleCommentMode()}
            >
              <MessagesSquare className="h-4 w-4" />
            </IconAction>
            {/* Settings are the studio's, not a domain's — the gear is always there. */}
            <IconAction label="Settings" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4" />
            </IconAction>
            {/* the panel's own composer is the way to reach the agent while it is open —
                and the bottom dock always has one under the view, open or not */}
            {!panelOpen && panelSide !== 'bottom' && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                <span data-tour="agent" className="contents">
                  <AgentSubmitButton />
                </span>
              </>
            )}
          </div>
        </header>

        <div
          className={cn(
            // the panel is rendered AFTER <main>, so a left dock reverses the row.
            // `relative` is what the bottom dock hangs off: it takes no room in here,
            // it floats over the view.
            'relative flex min-h-0 flex-1 flex-row',
            panelSide === 'left' && 'flex-row-reverse',
          )}
        >
          <main className="relative min-h-0 flex-1 overflow-hidden">
            {level === 'workspace' ? (
              <WorkspaceRouter
                domains={domains}
                onOpenDomain={openDomain}
                onOpenPublished={openPublished}
              />
            ) : publication && scopedDomainId ? (
              level === 'data' ? (
                <PublicationWithoutData domainId={scopedDomainId} publication={publication} />
              ) : (
                <PublicationRouter
                  domainId={scopedDomainId}
                  publication={publication}
                  lens={lens}
                />
              )
            ) : level === 'data' && scopedDomainId ? (
              <DataRouter
                domainId={scopedDomainId}
                origin={originOf(domains, scopedDomainId)}
                lens={dataLensOf(lens)}
              />
            ) : scopedDomainId ? (
              <SchemaRouter domainId={scopedDomainId} />
            ) : (
              <EmptyWorkspace />
            )}
          </main>
          <WorkPanel />
        </div>
      </div>

      <CommandPalette />
      <CommentModeOverlay />
      <CommentDraftPopover />
      <AskLayer />
      <SettingsDialog />
      <NewDomainDialog />
      <Tour />
    </TooltipProvider>
  )
}

/** A Domain's origin, as the bar and its levels name it; its id when the Workspace lists none. */
function originOf(domains: readonly DomainSummary[], domainId: string): string {
  return domains.find((domain) => domain.id === domainId)?.origin ?? domainId
}

/**
 * Nothing to look at yet. A workspace with no domain in it has exactly one thing
 * to offer, and the Workspace page that normally offers it is not drawn at the Domain
 * level — so it is offered here instead.
 */
function EmptyWorkspace() {
  const setNewDomainOpen = useUI((s) => s.setNewDomainOpen)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      This workspace has no domain yet.
      <button
        type="button"
        onClick={() => setNewDomainOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" /> New domain
      </button>
    </div>
  )
}
