import type { AgentRun, ChatInfo, HarnessStatus } from '@shared/types'
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
import { chatOf, useChatMutations, useChats } from '@/lib/chats'
import { threadsAwaitingAgent } from '@/lib/comments'
import { labelOf } from '@/lib/harnesses'
import { useComments, useHarness } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { AgentTurn, TurnDivider } from './agent-turn'
import { ChatEffortPicker } from './chat-effort'
import { ChatModelPicker } from './chat-model'
import { ChatTabs } from './chat-tabs'
import { toneOf } from './chat-tone'
import { DocumentsMenu, useDocumentMutations } from './documents'
import { HandoffChip } from './handoff-chip'

/** Turns more than an hour apart get a date between them; a burst does not. */
const HOUR = 60 * 60 * 1000

/**
 * The agent half of the work panel: the chat tabs on top, the selected
 * conversation below with its composer pinned at the bottom. Documents dropped
 * here join the domain context and can be named in the message, so the agent
 * knows which one to open.
 */
export function AgentTab({ domainId }: { domainId: string }) {
  const { data: chats } = useChats(domainId)
  const activeId = chats?.activeId
  const openChats = chats?.chats ?? []
  const chat = chatOf(openChats, activeId)
  const origin = chat?.origin
  const sourceOpen = origin ? openChats.some((entry) => entry.id === origin.chatId) : false
  const { select, forgetOrigin } = useChatMutations(domainId)
  const { data: harness } = useHarness(domainId)
  const turns = useAgentTurns(domainId, activeId)
  const run = useDisplayRun(domainId, activeId)
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
      <ChatTabs domainId={domainId} chats={openChats} activeId={activeId} harness={harness} />

      {/* type=scroll: the bar shows while scrolling and fades out — a chat should not
          carry a permanent gutter down its side. */}
      <ScrollArea ref={scroller} type="scroll" className="min-h-0 flex-1">
        <div className="space-y-4 px-3 py-3">
          {origin && (
            <HandoffChip
              origin={origin}
              harnessLabel={labelOf(harness, origin.harness)}
              tone={toneOf(openChats, origin.chatId, origin.harness)}
              onOpenSource={sourceOpen ? () => select.mutate(origin.chatId) : undefined}
              onForget={origin.pendingHandoff ? () => forgetOrigin.mutate(chat.id) : undefined}
            />
          )}
          {turns.map((turn, index) => (
            <div key={turn.id} className="space-y-2.5">
              {needsDivider(turns[index - 1], turn) && <TurnDivider at={turn.createdAt} />}
              <AgentTurn
                run={turn}
                onResume={() =>
                  void api
                    .agentResume(domainId, activeId)
                    .catch((error) => toast.error(`Could not continue — ${String(error)}`))
                }
              />
            </div>
          ))}
          {turns.length === 0 && (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              {chat?.origin
                ? 'Continue the work below — the summary above goes with your first message.'
                : 'No turns yet. Describe the change you want below.'}
            </p>
          )}
        </div>
      </ScrollArea>

      <Composer domainId={domainId} chat={chat} harness={harness} run={run} />

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
 * What the next turn already carries, said in the composer itself: send and these
 * threads go with it, message or no message. Purely indicative — the threads are
 * answered and resolved from the comments tab, never dismissed from here.
 */
function AwaitingThreadsChip({ count }: { count: number }) {
  if (count === 0) return null
  const plural = count === 1 ? '' : 's'
  return (
    <Chip tone="primary" title={`The agent answers ${count} open thread${plural} on its next turn`}>
      <MessageSquare className="h-3 w-3" />
      {count} open comment{plural}
    </Chip>
  )
}

function Composer({
  domainId,
  chat,
  harness,
  run,
}: {
  domainId: string
  chat?: ChatInfo
  harness?: HarnessStatus
  run: AgentRun | null
}) {
  const chatId = chat?.id
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const snapshot = useAgentSnapshot(domainId, chatId)
  const setRun = useAgentLive((state) => state.setRun)
  const { data: store } = useComments(domainId)
  const qc = useQueryClient()
  const active = isRunActive(run)
  const available = snapshot.data?.available ?? false
  // Open threads are themselves something to send: with any waiting, an empty composer
  // is a valid submit that carries them as they are. Mirrors the server's own rule
  // (agent/run/preparation.ts), which only rejects a turn that would carry nothing.
  const awaiting = threadsAwaitingAgent(store?.comments).length
  const sendsComments = awaiting > 0 && !text.trim()

  // grow with the content, up to half the panel
  useEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [text])

  const send = async () => {
    const message = text.trim()
    if ((!message && awaiting === 0) || sending || active || !available) return
    setSending(true)
    try {
      const result = await api.agentSubmit(domainId, message, chatId)
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
      qc.invalidateQueries({ queryKey: qk.agent(domainId, chatId) })
      qc.invalidateQueries({ queryKey: qk.chats(domainId) })
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
          placeholder={
            !available
              ? 'Agent unavailable'
              : awaiting > 0
                ? 'Send the open comments — or add a message…'
                : 'Message the agent…'
          }
          disabled={!available}
          className="w-full resize-none bg-transparent px-3 pt-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <DocumentsMenu domainId={domainId} />
          <AwaitingThreadsChip count={awaiting} />
          <div className="ml-auto flex items-center gap-1.5">
            {/* the meter sits before the model, in reading order: how hard, on what */}
            <ChatEffortPicker domainId={domainId} chat={chat} harness={harness} />
            <ChatModelPicker domainId={domainId} chat={chat} harness={harness} />
            {active ? (
              <button
                type="button"
                onClick={() =>
                  void api
                    .agentCancel(domainId, chatId)
                    .catch((error) => toast.error(`Could not stop the agent — ${String(error)}`))
                    // the turn settles a moment after the abort lands; ask the
                    // server rather than waiting on the frame that says so
                    .finally(() => qc.invalidateQueries({ queryKey: qk.agent(domainId, chatId) }))
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
                disabled={(!text.trim() && awaiting === 0) || sending || !available}
                title={sendsComments ? 'Send the open comments (↵)' : 'Send (↵)'}
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
