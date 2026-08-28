import type { AgentRun } from '@shared/types'
import type { DragEvent } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, MessageSquare, Square, Upload } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Chip } from '@/components/studio-kit'
import { ScrollArea } from '@/components/ui/misc'
import {
  isRunActive,
  useAgentLive,
  useAgentSnapshot,
  useAgentTurns,
  useDisplayRun,
} from '@/lib/agent'
import { api, qk } from '@/lib/api'
import { threadsAwaitingAgent } from '@/lib/comments'
import { useComments } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { AgentTurn, TurnDivider } from './agent-turn'
import { DocumentsMenu, useDocumentMutations } from './documents'

/** Turns more than an hour apart get a date between them; a burst does not. */
const HOUR = 60 * 60 * 1000

/**
 * The agent half of the work panel: one conversation, oldest at the top, the
 * composer pinned at the bottom. Documents dropped here join the domain context
 * and can be named in the message, so the agent knows which one to open.
 */
export function AgentTab({ domainId }: { domainId: string }) {
  const turns = useAgentTurns(domainId)
  const run = useDisplayRun(domainId)
  const [dragging, setDragging] = useState(false)
  const { upload } = useDocumentMutations(domainId)
  const scroller = useRef<HTMLDivElement>(null)

  // follow the conversation: a new turn, a new message or a new activity line all
  // move the bottom, and the bottom is what you are reading. The scrollable element
  // is ScrollArea's own viewport, not the Root we hold.
  const signature = `${turns.length}:${run?.events.length ?? 0}:${run?.status ?? ''}`
  useLayoutEffect(() => {
    const viewport = scroller.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [signature])

  const addFiles = (files: FileList | File[] | null) => {
    const list = files ? [...files] : []
    if (!list.length) return
    upload.mutate(list, {
      onSuccess: (added) =>
        toast.success(`Added ${added.length} document${added.length === 1 ? '' : 's'}`),
    })
  }

  const onDrop = (event: DragEvent) => {
    setDragging(false)
    const files = event.dataTransfer.files
    if (files?.length) {
      event.preventDefault()
      addFiles(files)
    }
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {/* type=scroll: the bar shows while scrolling and fades out — a chat should not
          carry a permanent gutter down its side. */}
      <ScrollArea ref={scroller} type="scroll" className="min-h-0 flex-1">
        <div className="space-y-4 px-3 py-3">
          {turns.map((turn, index) => (
            <div key={turn.id} className="space-y-2.5">
              {needsDivider(turns[index - 1], turn) && <TurnDivider at={turn.createdAt} />}
              <AgentTurn
                run={turn}
                onResume={() =>
                  void api
                    .agentResume(domainId)
                    .catch((error) => toast.error(`Could not continue — ${String(error)}`))
                }
              />
            </div>
          ))}
          {turns.length === 0 && (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              No turns yet. Describe the change you want below.
            </p>
          )}
        </div>
      </ScrollArea>

      <Composer domainId={domainId} run={run} />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/75">
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/50 bg-card px-5 py-3 text-sm font-medium text-primary">
            <Upload className="h-4 w-4" /> Drop to add
          </div>
        </div>
      )}
    </div>
  )
}

function needsDivider(previous: AgentRun | undefined, turn: AgentRun): boolean {
  if (!previous) return true
  return Date.parse(turn.createdAt) - Date.parse(previous.createdAt) > HOUR
}

/**
 * What the next turn already carries, said in the composer itself: send a message and
 * these threads go with it. Purely indicative — the threads are answered and resolved
 * from the comments tab, never dismissed from here.
 */
function AwaitingThreadsChip({ domainId }: { domainId: string }) {
  const { data: store } = useComments(domainId)
  const awaiting = threadsAwaitingAgent(store?.comments)
  if (awaiting.length === 0) return null
  const plural = awaiting.length === 1 ? '' : 's'
  return (
    <Chip
      tone="primary"
      title={`The agent answers ${awaiting.length} open thread${plural} on its next turn`}
    >
      <MessageSquare className="h-3 w-3" />
      {awaiting.length} open comment{plural}
    </Chip>
  )
}

function Composer({ domainId, run }: { domainId: string; run: AgentRun | null }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const snapshot = useAgentSnapshot(domainId)
  const setRun = useAgentLive((state) => state.setRun)
  const qc = useQueryClient()
  const active = isRunActive(run)
  const available = snapshot.data?.available ?? false

  // grow with the content, up to half the panel
  useEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [text])

  const send = async () => {
    const message = text.trim()
    if (!message || sending || active || !available) return
    setSending(true)
    try {
      const result = await api.agentSubmit(domainId, message)
      const error = (result as { error?: string }).error
      if (error) {
        toast.error(error)
        return
      }
      setRun(result as AgentRun)
      setText('')
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSending(false)
      qc.invalidateQueries({ queryKey: qk.agent(domainId) })
    }
  }

  return (
    <div className="shrink-0 px-3 pb-3 pt-2">
      <div className="rounded-xl border bg-card transition-colors focus-within:border-ring">
        <textarea
          ref={field}
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          placeholder={available ? 'Message the agent…' : 'Agent unavailable'}
          disabled={!available}
          className="w-full resize-none bg-transparent px-3 pt-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <DocumentsMenu domainId={domainId} />
          <AwaitingThreadsChip domainId={domainId} />
          <div className="ml-auto">
            {active ? (
              <button
                type="button"
                onClick={() =>
                  void api
                    .agentCancel(domainId)
                    .catch((error) => toast.error(`Could not stop the agent — ${String(error)}`))
                }
                title="Stop the agent"
                aria-label="Stop the agent"
                className="grid h-8 w-8 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-accent"
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={!text.trim() || sending || !available}
                title="Send (↵)"
                aria-label="Send"
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90',
                  'disabled:bg-muted disabled:text-muted-foreground',
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
