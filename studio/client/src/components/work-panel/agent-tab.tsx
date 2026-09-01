import type { AgentRun, ChatList, QueuedMessage } from '@shared/types'
import type { DragEvent, ReactNode } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, ListPlus, MessageSquare, Square, Upload } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

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
import { useComments, useDocuments, useHarness } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { AgentTurn, TurnDivider } from './agent-turn'
import { ChatEffortPicker } from './chat-effort'
import { ChatModelPicker } from './chat-model'
import { ChatTabs } from './chat-tabs'
import { toneOf } from './chat-tone'
import { AttachButton, CHIP, DocumentChips, useDocumentMutations } from './documents'
import { HandoffChip } from './handoff-chip'
import { MessageQueue, type PendingMessage } from './message-queue'

/** Turns more than an hour apart get a date between them; a burst does not. */
const HOUR = 60 * 60 * 1000

/** A chat with nothing waiting, as one stable array — a fresh [] would re-render. */
const NO_QUEUE: QueuedMessage[] = []

/** A submit still on the wire, and the tab it belongs to — tabs share a composer. */
interface PendingSend extends PendingMessage {
  chatId?: string
}

/** What the composer asks for, always — never what it is already carrying. */
const PROMPT = 'Message the agent…'

/**
 * The agent half of the work panel: the chat tabs on top, the selected
 * conversation below with its composer pinned at the bottom.
 *
 * The three pieces are exported apart because the bottom dock takes them apart:
 * there the composer is the resting state — a bar floating over the view — and
 * the transcript is what unfolds above it. Docked left or right they stack, and
 * this is that stack.
 */
export function AgentTab({ domainId }: { domainId: string }) {
  return (
    <AgentDropZone domainId={domainId} className="relative flex h-full min-h-0 flex-col">
      <AgentTranscript domainId={domainId} />
      <AgentComposer domainId={domainId} />
    </AgentDropZone>
  )
}

/**
 * Whatever it wraps takes documents by drag and drop. Dropped files join the
 * domain context and can be named in the message, so the agent knows which one
 * to open.
 */
export function AgentDropZone({
  domainId,
  className,
  ref,
  children,
  ...rest
}: {
  domainId: string
  className?: string
  ref?: React.Ref<HTMLDivElement>
  children: ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  const [dragging, setDragging] = useState(false)
  const { upload } = useDocumentMutations(domainId)

  const onDrop = (event: DragEvent) => {
    setDragging(false)
    const files = [...(event.dataTransfer.files ?? [])]
    if (!files.length) return
    event.preventDefault()
    upload.mutate(files, {
      onSuccess: (added) =>
        toast.success(`Added ${added.length} document${added.length === 1 ? '' : 's'}`),
    })
  }

  return (
    <div
      {...rest}
      ref={ref}
      className={className}
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
      {children}
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

/** The chat tabs and the turns under them — everything but the composer. */
export function AgentTranscript({ domainId }: { domainId: string }) {
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
  const scroller = useRef<HTMLDivElement>(null)

  // follow the conversation: a new turn, a new message or a new activity line all
  // move the bottom, and the bottom is what you are reading. The scrollable element
  // is ScrollArea's own viewport, not the Root we hold.
  const signature = `${turns.length}:${run?.events.length ?? 0}:${run?.status ?? ''}`
  useLayoutEffect(() => {
    const viewport = scroller.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [signature])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
                  // a refused resume answers 200 with an error field; without
                  // this the button would look like it did nothing at all
                  void api.agentResume(domainId, activeId).then(
                    (result) => {
                      if (result.error) toast.error(`Could not continue — ${result.error}`)
                    },
                    (error) => toast.error(`Could not continue — ${String(error)}`),
                  )
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
    </div>
  )
}

function needsDivider(previous: AgentRun | undefined, turn: AgentRun): boolean {
  if (!previous) return true
  return Date.parse(turn.createdAt) - Date.parse(previous.createdAt) > HOUR
}

/**
 * What the next turn carries, laid out where you are about to send it: the
 * documents the agent can read, and the threads it will answer.
 *
 * The threads come as ONE chip saying how many there are, not one chip each. What
 * a thread is pinned on, and what it says, is the comments tab's job — this line
 * only has to say how much the next turn is carrying, and stay one line while it
 * does. So the chip is a way IN: it opens that tab. It cannot be taken off, unlike
 * a document — a turn answers every open thread, and that is the server's rule
 * (agent/run/preparation.ts), not a choice made here.
 */
function TurnPayload({ domainId }: { domainId: string }) {
  const { data: docs } = useDocuments(domainId)
  const { data: store } = useComments(domainId)
  const setPanelTab = useUI((state) => state.setPanelTab)
  const awaiting = threadsAwaitingAgent(store?.comments).length
  if (!docs?.length && !awaiting) return null

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 pt-2">
      {awaiting > 0 && (
        <button
          type="button"
          onClick={() => setPanelTab('comments')}
          title={`The agent answers ${awaiting === 1 ? 'this thread' : 'these threads'} on its next turn — click to read ${awaiting === 1 ? 'it' : 'them'}`}
          className={cn(
            CHIP,
            'gap-1.5 border-primary/30 bg-primary/10 pr-2.5 text-primary transition-colors hover:bg-primary/20',
          )}
        >
          <MessageSquare className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {awaiting} comment{awaiting === 1 ? '' : 's'}
          </span>
        </button>
      )}
      <DocumentChips domainId={domainId} />
    </div>
  )
}

/**
 * Where you write to the agent. Docked, it is the last row of the panel; in the
 * bottom dock it is the whole resting state, floating over the view — which is
 * why it resolves its own chat instead of being handed one, and why `onFocus` is
 * a prop: typing in it is what opens the conversation above it.
 */
export function AgentComposer({
  domainId,
  bar,
  expanded,
  onFocus,
  trailing,
}: {
  domainId: string
  /** Be the dock's bar: one line, in the frame you were given, drawing none of its own. */
  bar?: boolean
  /** Bar only — the conversation above is open, so the row can afford the rest of itself. */
  expanded?: boolean
  onFocus?: () => void
  /** An extra control for the row — the dock's own way back to the comment threads. */
  trailing?: ReactNode
}) {
  const { data: chats } = useChats(domainId)
  const chat = chatOf(chats?.chats ?? [], chats?.activeId)
  const { data: harness } = useHarness(domainId)
  const run = useDisplayRun(domainId, chats?.activeId)
  const chatId = chat?.id
  // the draft lives in the store: re-docking the panel unmounts the composer, and a
  // half-written message must survive that
  const text = useUI((state) => state.agentDraft)
  const setText = useUI((state) => state.setAgentDraft)
  const [pending, setPending] = useState<PendingSend[]>([])
  const ticket = useRef(0)
  const field = useRef<HTMLTextAreaElement>(null)
  const snapshot = useAgentSnapshot(domainId, chatId)
  const setRun = useAgentLive((state) => state.setRun)
  const { data: store } = useComments(domainId)
  const { data: docs } = useDocuments(domainId)
  const qc = useQueryClient()
  const active = isRunActive(run)
  const available = snapshot.data?.available ?? false
  // Open threads and attached documents are themselves something to send: with either,
  // an empty composer is a valid submit that carries them as they are. Mirrors the
  // server's own rule (agent/run/preparation.ts), which only rejects an empty turn.
  const awaiting = threadsAwaitingAgent(store?.comments).length
  // Not while a turn runs, though — they go with whatever turn starts next, so an
  // empty composer would queue a blank message to say so. And not before the chips
  // are on screen: a resting bar shows one line, so a send button on an empty field
  // would be a turn nobody could see.
  const payloadShowing = !bar || !!expanded
  const carriesPayload = payloadShowing && !active && (awaiting > 0 || (docs?.length ?? 0) > 0)
  const sendsPayload = carriesPayload && !text.trim()
  const sendable = !!text.trim() || carriesPayload
  const canSend = available && sendable

  // grow with the content, up to half the panel
  useEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [text])

  // A failed send must never be the reason a message is gone: nothing typed
  // since gets it back as it was, something typed gets it in front of that.
  const restore = (message: string, error: string) => {
    toast.error(error)
    if (!message) return
    // the draft lives in the store, so read what is there NOW rather than closing
    // over the render that started the send
    const current = useUI.getState().agentDraft
    setText(current.trim() ? `${message}\n\n${current}` : message)
  }

  // The server parked the message; show it on the tab it belongs to now, rather
  // than a refetch later — the refresh below reconciles either way.
  const landQueued = (message: QueuedMessage) => {
    if (!chatId) return
    qc.setQueryData<ChatList>(qk.chats(domainId), (current) =>
      current
        ? {
            ...current,
            chats: current.chats.map((entry) =>
              entry.id === chatId && !entry.queued.some((waiting) => waiting.id === message.id)
                ? { ...entry, queued: [...entry.queued, message] }
                : entry,
            ),
          }
        : current,
    )
  }

  /**
   * Send what is typed — into the turn if the chat is free, into the queue if not.
   *
   * The field empties on the KEYSTROKE, not on the answer: a submit builds the
   * domain bundle and probes the harness before it replies, and a composer that
   * holds the text until then reads as an Enter that never registered. What
   * replaces it immediately is a row in the queue strip, so the message is
   * visible the whole way — and comes back to the field if the send failed.
   */
  // what an empty send is carrying, said in one phrase for the queue strip
  const carriedLabel =
    awaiting > 0
      ? `${awaiting} open comment${awaiting === 1 ? '' : 's'}`
      : `${docs?.length ?? 0} document${(docs?.length ?? 0) === 1 ? '' : 's'}`

  const send = () => {
    if (!canSend) return
    const message = text.trim()
    const entry: PendingSend = {
      id: `pending-${(ticket.current += 1)}`,
      label: message || carriedLabel,
      chatId,
    }
    setText('')
    setPending((current) => [...current, entry])
    const drop = () => setPending((current) => current.filter((row) => row.id !== entry.id))
    const refresh = () => {
      qc.invalidateQueries({ queryKey: qk.agent(domainId, chatId) })
      qc.invalidateQueries({ queryKey: qk.chats(domainId) })
    }
    void api.agentSubmit(domainId, message, chatId).then(
      (result) => {
        drop()
        if (result.error) restore(message, result.error)
        else if (result.run) setRun(result.run)
        else if (result.queued) landQueued(result.queued)
        refresh()
      },
      (error) => {
        drop()
        restore(message, String(error))
        refresh()
      },
    )
  }

  const composed = (
    <textarea
      ref={field}
      data-agent-composer=""
      rows={1}
      value={text}
      onFocus={onFocus}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          send()
        }
      }}
      // One prompt, whatever the turn happens to be carrying. The chips above already
      // show the threads and the documents; saying it again here only made the field
      // read differently from one moment to the next.
      placeholder={available ? PROMPT : 'Agent unavailable'}
      disabled={!available}
      className={cn(
        'resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground',
        bar ? 'min-w-0 flex-1 px-1 py-1' : 'w-full px-3 pt-2.5',
      )}
    />
  )

  const stop = (
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
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-accent"
    >
      <Square className="h-3 w-3 fill-current" />
    </button>
  )

  const submit = (
    <button
      type="button"
      onClick={send}
      disabled={!canSend}
      title={
        active
          ? 'Queue for when this turn ends (↵)'
          : sendsPayload
            ? 'Send what the composer carries (↵)'
            : 'Send (↵)'
      }
      aria-label={active ? 'Queue message' : 'Send'}
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90',
        'disabled:bg-muted disabled:text-muted-foreground',
      )}
    >
      {active ? <ListPlus className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
    </button>
  )

  // The dock's bar: one line, and on it only what is worth a line. At rest that is
  // the clip, the field and the way to the threads — no payload, no model to read,
  // and nothing to send until there is something written to send.
  if (bar)
    return (
      <div className="shrink-0">
        {payloadShowing && (
          <>
            <MessageQueue
              domainId={domainId}
              chatId={chatId}
              queued={chat?.queued ?? NO_QUEUE}
              pending={pending.filter((entry) => entry.chatId === chatId)}
              running={active}
            />
            <TurnPayload domainId={domainId} />
          </>
        )}
        {/* items-end so a field that grew to several lines keeps the controls at its
            foot; the controls then centre among THEMSELVES, or the model's 11px label
            would sit a third of a line below the icons it shares the row with */}
        <div className="flex items-end gap-1 px-2 py-2">
          <AttachButton domainId={domainId} onPicked={() => field.current?.focus()} />
          {composed}
          <div className="flex shrink-0 items-center gap-1">
            {/* the meter sits before the model, in reading order: how hard, on what */}
            {expanded && <ChatEffortPicker domainId={domainId} chat={chat} harness={harness} />}
            {expanded && <ChatModelPicker domainId={domainId} chat={chat} harness={harness} />}
            {trailing}
            {/* a running turn keeps Stop within reach even on the resting bar; Send
                only shows once there is something to send, or the bar gains a button
                it could not explain */}
            {active && stop}
            {sendable && submit}
          </div>
        </div>
      </div>
    )

  return (
    <div className="shrink-0 px-3 pb-3 pt-2">
      <MessageQueue
        domainId={domainId}
        chatId={chatId}
        queued={chat?.queued ?? NO_QUEUE}
        // one composer serves every tab, so a send still on the wire must not
        // show up under the queue of the tab you switched to meanwhile
        pending={pending.filter((entry) => entry.chatId === chatId)}
        running={active}
      />
      <div className="rounded-xl border bg-card transition-colors focus-within:border-ring">
        <TurnPayload domainId={domainId} />
        {composed}
        <div className="flex items-center gap-1 px-2 pb-2">
          <AttachButton domainId={domainId} onPicked={() => field.current?.focus()} />
          <div className="ml-auto flex items-center gap-1.5">
            {/* the meter sits before the model, in reading order: how hard, on what */}
            <ChatEffortPicker domainId={domainId} chat={chat} harness={harness} />
            <ChatModelPicker domainId={domainId} chat={chat} harness={harness} />
            {trailing}
            {/* Stop and Send are both live while a turn runs: one ends what the
                agent is doing, the other lines up what it does next, and needing
                the first to reach the second is what the queue exists to undo. */}
            {active && stop}
            {submit}
          </div>
        </div>
      </div>
    </div>
  )
}
