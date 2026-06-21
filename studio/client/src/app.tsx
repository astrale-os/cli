import type { StudioEvent } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import {
  Library,
  type LucideIcon,
  MessageSquare,
  MessagesSquare,
  Network,
  Search,
  Settings,
  Workflow,
} from 'lucide-react'
import { useCallback, useEffect } from 'react'

import { AgentActivityDrawer, AgentSubmitButton } from '@/components/agent-activity'
import { AnchorButton } from '@/components/anchor'
import { AskLayer } from '@/components/ask-popover'
import { CommandPalette } from '@/components/command-palette'
import { CommentDraftPopover } from '@/components/comment-draft-popover'
import { CommentModeOverlay } from '@/components/comment-mode'
import { DomainSelector } from '@/components/domain-selector'
import { EnvBadge } from '@/components/env-editor'
import { InstanceBadge } from '@/components/instance-badge'
import { InstanceSwitcher } from '@/components/instance-switcher'
import { SettingsDialog } from '@/components/settings-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/misc'
import { UpdatesBadge } from '@/components/updates-badge'
import { useAgentLive, useAgentSnapshot } from '@/lib/agent'
import { qk } from '@/lib/api'
import { useComments, useInvalidateDomain, useWorkspace } from '@/lib/hooks'
import { useEventStream } from '@/lib/sse'
import { type SectionKey, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { SchemaSection } from '@/schema-studio'
import { CommentsSection } from '@/sections/comments'
import { ContextSection } from '@/sections/context'
import { ProcessSection } from '@/sections/process'

const NAV: { key: SectionKey; label: string; icon: LucideIcon }[] = [
  { key: 'context', label: 'Context', icon: Library },
  { key: 'schema', label: 'Schema', icon: Network },
  { key: 'process', label: 'Process', icon: Workflow },
  { key: 'comments', label: 'Comments', icon: MessageSquare },
]

function SectionRouter({ section, domainId }: { section: SectionKey; domainId: string }) {
  switch (section) {
    case 'schema':
      return <SchemaSection domainId={domainId} />
    case 'context':
      return <ContextSection domainId={domainId} />
    case 'process':
      return <ProcessSection domainId={domainId} />
    case 'comments':
      return <CommentsSection domainId={domainId} />
  }
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
    <TooltipProvider delayDuration={200}>
      <div className="h-full flex flex-col">
        {/* header */}
        <header className="flex items-center gap-3 px-5 h-14 border-b shrink-0">
          {/* left: the GLOBAL active instance + the domain you're viewing + its deploy status */}
          <div className="flex items-center gap-1.5">
            <InstanceSwitcher />
            <DomainSelector />
            {domainId && <InstanceBadge domainId={domainId} />}
            {domainId && (
              <button
                type="button"
                aria-label="Settings"
                title="Settings"
                onClick={() => setSettingsOpen(true)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
            {domainId && <UpdatesBadge domainId={domainId} />}
            {domainId && <EnvBadge domainId={domainId} />}
          </div>

          {/* right: tools */}
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              title="Search (⌘K)"
            >
              <Search className="h-4 w-4" />
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                ⌘K
              </kbd>
            </Button>
            <Button
              variant={commentMode ? 'default' : 'ghost'}
              size="sm"
              aria-label="Comment mode"
              onClick={() => toggleCommentMode()}
              title="Comment mode — click any element to comment (C)"
            >
              <MessagesSquare className="h-4 w-4" />
              <kbd
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  commentMode
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                C
              </kbd>
            </Button>
            <div className="h-5 w-px bg-border mx-0.5" />
            <AgentSubmitButton />
          </div>
        </header>

        <main className="flex-1 min-h-0 relative overflow-hidden">
          {domainId ? (
            <SectionRouter section={section} domainId={domainId} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              No domain selected
            </div>
          )}

          {/* macOS-style dock */}
          <nav className="absolute bottom-5 left-1/2 -translate-x-1/2 z-40">
            <div className="flex items-center gap-1 rounded-2xl border bg-card/70 px-2 py-2 shadow-2xl shadow-black/40 backdrop-blur-xl">
              {NAV.map((n) => {
                const Icon = n.icon
                const active = section === n.key
                const badge = n.key === 'comments' ? myReplyCount : 0
                return (
                  <Tooltip key={n.key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setSection(n.key)}
                        className={cn(
                          'relative h-11 w-11 rounded-xl flex items-center justify-center transition-all duration-150',
                          active
                            ? 'bg-primary/15 text-primary'
                            : 'text-muted-foreground hover:-translate-y-1 hover:bg-accent hover:text-foreground',
                        )}
                      >
                        <Icon className="h-[19px] w-[19px]" />
                        {badge > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                            {badge > 99 ? '99+' : badge}
                          </span>
                        )}
                        {active && (
                          <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={10}>
                      {n.label}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </nav>
        </main>
      </div>

      <CommandPalette />
      <CommentModeOverlay />
      <CommentDraftPopover />
      <AskLayer />
      <AgentActivityDrawer />
      <SettingsDialog />
    </TooltipProvider>
  )
}
