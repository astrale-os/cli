import {
  Boxes,
  type LucideIcon,
  MessagesSquare,
  Network,
  Plus,
  Search,
  Settings,
  Workflow,
} from 'lucide-react'
import { lazy, type ReactNode, Suspense, useEffect } from 'react'

import { AgentSubmitButton } from '@/components/agent-activity'
import { AskLayer } from '@/components/ask-popover'
import { CommandPalette } from '@/components/command-palette'
import { CommentDraftPopover } from '@/components/comment-draft-popover'
import { CommentModeOverlay } from '@/components/comment-mode'
import { NewDomainDialog } from '@/components/create-domain'
import { InstanceSwitcher } from '@/components/instance-switcher'
import { SettingsDialog } from '@/components/settings-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/misc'
import { UpdatesBadge } from '@/components/updates-badge'
import { WorkPanel } from '@/components/work-panel'
import { useAgentLive, useAgentSnapshot } from '@/lib/agent'
import { useWorkspace } from '@/lib/hooks'
import { type SectionKey, useUI } from '@/lib/store'
import { useStudioEventSync } from '@/lib/studio-events'
import { cn } from '@/lib/utils'
import { ActivateDomainDialog } from '@/schema-studio/activate-domain-dialog'
import { useCanvasSelectionSync } from '@/schema-studio/workspace/canvas-selection'
import { ProcessSection } from '@/sections/process'

const LazySchemaSection = lazy(() =>
  import('./schema-studio/index').then(({ SchemaSection }) => ({ default: SchemaSection })),
)

const NAV: { key: SectionKey; label: string; icon: LucideIcon }[] = [
  { key: 'schema', label: 'Schema', icon: Network },
  { key: 'core', label: 'Core', icon: Boxes },
  { key: 'process', label: 'Process', icon: Workflow },
]

function SectionRouter({ section, domainId }: { section: SectionKey; domainId: string }) {
  switch (section) {
    // Schema and Core are two readings of one domain — the same lazily-loaded studio,
    // asked for a different canvas.
    case 'schema':
    case 'core':
      return (
        <Suspense
          fallback={
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Loading schema studio…
            </div>
          }
        >
          <LazySchemaSection domainId={domainId} mode={section} />
        </Suspense>
      )
    case 'process':
      return <ProcessSection domainId={domainId} />
  }
}

/** A header action: icon only, its name and shortcut in the tooltip. */
function IconAction({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  active?: boolean
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
          onClick={onClick}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
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
  const { data: domains } = useWorkspace()
  const domainId = useUI((s) => s.domainId)
  const section = useUI((s) => s.section)
  const setDomain = useUI((s) => s.setDomain)
  const setSection = useUI((s) => s.setSection)
  const setPaletteOpen = useUI((s) => s.setPaletteOpen)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const commentMode = useUI((s) => s.commentMode)
  const panelOpen = useUI((s) => s.panelOpen)
  const panelSide = useUI((s) => s.panelSide)
  const toggleCommentMode = useUI((s) => s.toggleCommentMode)
  const toggleAskMode = useUI((s) => s.toggleAskMode)
  const setRun = useAgentLive((s) => s.setRun)

  // pick the first domain once the workspace loads
  useEffect(() => {
    if (!domainId && domains && domains.length) {
      let last: string | null = null
      try {
        last = localStorage.getItem('studio.lastDomain')
      } catch {}
      setDomain(last && domains.some((d) => d.id === last) ? last : domains[0].id)
    }
  }, [domains, domainId, setDomain])

  useStudioEventSync()
  // The domains rail lives inside the section, so the invariant it depends on — the canvas
  // always holds the active domain — is kept here, where every section can see it.
  useCanvasSelectionSync()

  // keep the merge-forward agent store in sync with the authoritative snapshot —
  // recovers the terminal run state if an `agent-run` frame was ever missed.
  const { data: agentSnap } = useAgentSnapshot(domainId)
  useEffect(() => {
    if (agentSnap?.run) setRun(agentSnap.run)
  }, [agentSnap, setRun])

  // global hotkeys: C toggles comment mode, A toggles ask mode (both ignored while typing)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        toggleCommentMode()
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        toggleAskMode()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [toggleCommentMode, toggleAskMode])

  if (!domains) {
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
          {/* what you are looking at — which DOMAIN is the rail's question, not this bar's */}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <InstanceSwitcher />
            {domainId && <UpdatesBadge domainId={domainId} />}
          </div>

          {/* where you are */}
          <nav className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
            {NAV.map((n) => {
              const Icon = n.icon
              const active = section === n.key
              return (
                <button
                  key={n.key}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setSection(n.key)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                    active
                      ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden md:inline">{n.label}</span>
                </button>
              )
            })}
          </nav>

          {/* what you can do */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
            <IconAction label="Search" shortcut="⌘K" onClick={() => setPaletteOpen(true)}>
              <Search className="h-4 w-4" />
            </IconAction>
            <IconAction
              label="Comment mode"
              shortcut="C"
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
                <AgentSubmitButton />
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
            {domainId ? (
              <SectionRouter section={section} domainId={domainId} />
            ) : (
              <EmptyWorkspace empty={domains.length === 0} />
            )}
          </main>
          {domainId && <WorkPanel domainId={domainId} />}
        </div>
      </div>

      <CommandPalette />
      <CommentModeOverlay />
      <CommentDraftPopover />
      <AskLayer />
      <SettingsDialog />
      <ActivateDomainDialog />
      <NewDomainDialog />
    </TooltipProvider>
  )
}

/**
 * Nothing to look at yet. A workspace with no domain in it has exactly one thing
 * to offer, and the rail that normally offers it is inside a section that cannot
 * draw — so it is offered here instead.
 */
function EmptyWorkspace({ empty }: { empty: boolean }) {
  const setNewDomainOpen = useUI((s) => s.setNewDomainOpen)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      {empty ? 'This workspace has no domain yet.' : 'No domain selected'}
      {empty && (
        <button
          type="button"
          onClick={() => setNewDomainOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New domain
        </button>
      )}
    </div>
  )
}
