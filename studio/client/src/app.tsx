import type { StudioEvent } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import {
  Boxes,
  type LucideIcon,
  MessagesSquare,
  Network,
  Search,
  Settings,
  Workflow,
} from 'lucide-react'
import { lazy, type ReactNode, Suspense, useCallback, useEffect } from 'react'

import { AgentSubmitButton } from '@/components/agent-activity'
import { AskLayer } from '@/components/ask-popover'
import { CommandPalette } from '@/components/command-palette'
import { CommentDraftPopover } from '@/components/comment-draft-popover'
import { CommentModeOverlay } from '@/components/comment-mode'
import { DomainSelector } from '@/components/domain-selector'
import { InstanceBadge } from '@/components/instance-badge'
import { InstanceSwitcher } from '@/components/instance-switcher'
import { SettingsDialog } from '@/components/settings-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/misc'
import { UpdatesBadge } from '@/components/updates-badge'
import { WorkPanel } from '@/components/work-panel'
import { useAgentLive, useAgentSnapshot } from '@/lib/agent'
import { qk } from '@/lib/api'
import { useComments, useInvalidateDomain, useWorkspace } from '@/lib/hooks'
import { useEventStream } from '@/lib/sse'
import { type SectionKey, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
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
  const invalidate = useInvalidateDomain()
  const setRun = useAgentLive((s) => s.setRun)
  const appendEvent = useAgentLive((s) => s.appendEvent)
  const qc = useQueryClient()

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

  // live updates
  const onEvent = useCallback(
    (e: StudioEvent) => {
      // (re)connected — SSE has no replay, so resync the active domain in case
      // frames were missed during a drop (the snapshot effect below adopts the
      // authoritative run, recovering a stuck "running" drawer after a backend restart).
      if (e.type === 'hello') {
        const id = useUI.getState().domainId
        if (id) {
          invalidate(id)
          qc.invalidateQueries({ queryKey: qk.agent(id) })
          qc.invalidateQueries({ queryKey: qk.agentHistory(id) })
        }
        return
      }
      // workspace changed (a domain was added/removed on disk) — refresh the domain list
      if (e.type === 'workspace') {
        qc.invalidateQueries({ queryKey: qk.workspace })
        return
      }
      // agent loop: feed the live store directly (don't refetch the whole domain on every event)
      if (e.type === 'agent-event') {
        appendEvent(e.domainId, e.runId, e.event)
        return
      }
      if (e.type === 'agent-run') {
        setRun(e.run)
        qc.invalidateQueries({ queryKey: qk.agent(e.domainId) })
        // a finished turn joins the stored transcript the chat reads
        if (e.run.status !== 'running' && e.run.status !== 'queued')
          qc.invalidateQueries({ queryKey: qk.agentHistory(e.domainId) })
        return
      }
      // the origin lives in the schema, so a schema edit can rename the domain —
      // refresh the workspace list too, keeping the selector label in sync.
      if (e.type === 'schema-diff') {
        invalidate(e.domainId)
        qc.invalidateQueries({ queryKey: qk.workspace })
        return
      }
      if ('domainId' in e && e.domainId) invalidate(e.domainId)
    },
    [invalidate, setRun, appendEvent, qc],
  )
  useEventStream(onEvent)

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

  const { data: comments } = useComments(domainId)
  // "waiting for my reply" = open threads whose last word came from the agent.
  const myReplyCount =
    comments?.comments.filter((c) => c.status === 'open' && c.thread.at(-1)?.role === 'author')
      .length ?? 0

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
          {/* what you are looking at: instance → domain → its deploy state */}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <InstanceSwitcher />
            <span className="mx-1 h-4 w-px bg-border" />
            <DomainSelector />
            {domainId && <InstanceBadge domainId={domainId} />}
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
            {/* Settings are per-domain (they save to that domain's .domain-studio/settings.json),
                so the gear only exists once there is a domain to settle them on. */}
            {domainId && (
              <IconAction label="Settings" onClick={() => setSettingsOpen(true)}>
                <Settings className="h-4 w-4" />
              </IconAction>
            )}
            {/* the panel's own composer is the way to reach the agent while it is open */}
            {!panelOpen && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                <AgentSubmitButton />
              </>
            )}
          </div>
        </header>

        <div
          className={cn(
            // the panel is rendered AFTER <main>, so a left dock reverses the row
            'flex min-h-0 flex-1',
            panelSide === 'bottom' ? 'flex-col' : 'flex-row',
            panelSide === 'left' && 'flex-row-reverse',
          )}
        >
          <main className="relative min-h-0 flex-1 overflow-hidden">
            {domainId ? (
              <SectionRouter section={section} domainId={domainId} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No domain selected
              </div>
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
    </TooltipProvider>
  )
}
