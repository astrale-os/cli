import type { AgentRun, ChatAttachment, ChatList, QueuedMessage } from '@shared/types'
import type { QueryClient } from '@tanstack/react-query'
import type { ClipboardEvent, ReactNode } from 'react'

import { imagesLabel } from '@shared/attachments'
import { useQueryClient } from '@tanstack/react-query'
import { Image as ImageIcon, ListPlus, Loader2, Square, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ComposerField, ComposerFrame, DropZone, SendButton } from '@/components/composer'
import { ScrollArea } from '@/components/ui/misc'
import {
  type HarnessLink,
  harnessLink,
  isRunActive,
  pendingRun,
  useAgentLive,
  useAgentSnapshot,
  useAgentTurns,
  useDisplayRun,
} from '@/lib/agent'
import { useReadAgentReplies } from '@/lib/agent-unread'
import { api, qk } from '@/lib/api'
import { isImageFile, useComposerImages, useDraftImages } from '@/lib/attachments'
import { chatOf, useChatMutations, useChats } from '@/lib/chats'
import { labelOf, noAgentNotice, presenceOf } from '@/lib/harnesses'
import { useHarness, useWorkspace, useWorkspaceDocuments } from '@/lib/hooks'
import { agentDraftOf, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { AgentTurn, TurnDivider } from './agent-turn'
import { ChatEffortPicker } from './chat-effort'
import { ChatFastToggle } from './chat-fast'
import { ChatModelPicker } from './chat-model'
import { ChatTabs } from './chat-tabs'
import { toneOf } from './chat-tone'
import { CommentPicker, useAttachedComments } from './comment-picker'
import { DockActivity } from './dock-activity'
import { AttachButton, DocumentChips } from './documents'
import { HandoffChip } from './handoff-chip'
import { ComposerImages } from './images'
import { MessageQueue, type PendingMessage } from './message-queue'
import { NewDomainChip } from './new-domain-chip'

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

/** Every document the workspace's domains have given the agent. */
function countDocuments(groups: { documents?: readonly unknown[] }[]): number {
  return groups.reduce((total, group) => total + (group.documents?.length ?? 0), 0)
}

/** Run the last turn again, as it was first sent. */
function retryTurn(turn: AgentRun, chatId: string | undefined, qc: QueryClient): void {
  void api
    .agentSubmit(
      turn.instruction,
      chatId,
      turn.targetCommentIds,
      turn.attachments?.map((attachment) => attachment.id),
    )
    .then(
      (result) => {
        if (result.run) useAgentLive.getState().setRun(result.run)
        if (result.error) toast.error(`Could not retry — ${result.error}`)
        qc.invalidateQueries({ queryKey: qk.agent(chatId) })
        qc.invalidateQueries({ queryKey: qk.agentHistory(chatId) })
      },
      (error) => toast.error(`Could not retry — ${String(error)}`),
    )
}

/** Pick an interrupted turn back up. */
function resumeTurn(chatId: string | undefined): void {
  // a refused resume answers 200 with an error field; without
  // this the button would look like it did nothing at all
  void api.agentResume(chatId).then(
    (result) => {
      if (result.error) toast.error(`Could not continue — ${result.error}`)
    },
    (error) => toast.error(`Could not continue — ${String(error)}`),
  )
}

/**
 * The agent half of the work panel: the chat tabs on top, the selected
 * conversation below with its composer pinned at the bottom.
 *
 * The three pieces are exported apart because the bottom dock takes them apart:
 * there the composer is the resting state — a bar floating over the view — and
 * the transcript is what unfolds above it. Docked left or right they stack, and
 * this is that stack.
 */
export function AgentTab() {
  return (
    <AgentDropZone className="relative flex h-full min-h-0 flex-col">
      <AgentTranscript />
      <AgentComposer />
    </AgentDropZone>
  )
}

/**
 * Whatever it wraps takes files by drag and drop. A dropped image goes with the
 * next message, like a pasted one — it is something to look at now. Any other
 * file joins the domain context and can be named in the message, so the agent
 * knows which one to open.
 */
export function AgentDropZone({
  children,
  ...rest
}: {
  className?: string
  ref?: React.Ref<HTMLDivElement>
  children: ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  const { data: domains = [] } = useWorkspace()
  const { data: chats } = useChats()
  const { attach } = useComposerImages(chats?.activeId)
  const queryClient = useQueryClient()

  const upload = async (files: File[]) => {
    if (!files.length) return
    if (domains.length !== 1) {
      toast.info('Choose a domain with the paperclip before attaching documents.')
      return
    }
    const domain = domains[0]!
    try {
      const added = await api.uploadDocuments(domain.id, files)
      await queryClient.invalidateQueries({ queryKey: qk.documents(domain.id) })
      toast.success(`Added ${added.length} document${added.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(String(error))
    }
  }

  return (
    <DropZone
      {...rest}
      onFiles={(files) => {
        const images = files.filter(isImageFile)
        if (images.length) attach(images)
        void upload(files.filter((file) => !isImageFile(file)))
      }}
    >
      {children}
    </DropZone>
  )
}

/** The chat tabs and the turns under them — everything but the composer. */
export function AgentTranscript() {
  const qc = useQueryClient()
  const { data: chats } = useChats()
  const activeId = chats?.activeId
  const openChats = chats?.chats ?? []
  const chat = chatOf(openChats, activeId)
  const origin = chat?.origin
  const sourceOpen = origin ? openChats.some((entry) => entry.id === origin.chatId) : false
  const { select, forgetOrigin } = useChatMutations()
  const { data: harness } = useHarness()
  const turns = useAgentTurns(activeId)
  useReadAgentReplies(activeId, turns)
  const run = useDisplayRun(activeId)
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
      <ChatTabs chats={openChats} activeId={activeId} harness={harness} />

      {/* type=scroll: the bar shows while scrolling and fades out — a chat should not
          carry a permanent gutter down its side. */}
      <ScrollArea ref={scroller} type="scroll" className="min-h-0 flex-1">
        <div className="space-y-4 px-3 py-3">
          {chat?.newDomain ? <NewDomainChip domain={chat.newDomain} /> : null}
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
                onRetry={
                  index === turns.length - 1 ? () => retryTurn(turn, activeId, qc) : undefined
                }
                onResume={() => resumeTurn(activeId)}
              />
            </div>
          ))}
          {turns.length === 0 && (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              {origin
                ? 'Continue the work below — the summary above goes with your first message.'
                : chat?.newDomain
                  ? 'Describe how this new domain should evolve below.'
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
 * documents the agent can read, and the open threads.
 *
 * The threads come as ONE chip, not one chip each. By default it only SAYS there
 * are open threads — they do not ride a turn unasked — and it opens the picker
 * where the user attaches the ones the next message is about.
 */
function TurnPayload() {
  const { data: documentGroups } = useWorkspaceDocuments()
  const { awaiting } = useAttachedComments()
  if (!countDocuments(documentGroups) && !awaiting) return null

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 pt-2">
      <CommentPicker />
      <DocumentChips />
    </div>
  )
}

/**
 * Whether the agent can be written to at all, said above the field it governs.
 *
 * A disabled composer with no explanation is the whole of the bug this answers:
 * reaching the agent means spawning it and handshaking over ACP, which takes
 * seconds, and until that lands there is nothing to send TO. So the wait says it
 * is a wait — spinner, and the agent it is waiting on — and a handshake that
 * came back empty-handed says what came back instead of leaving the field mute.
 *
 * A line is what a PANEL can spend on this. The dock's resting bar is one line
 * and stays one line, so there the same three states ride in the row itself —
 * see `linkMark`.
 */
function LinkStatus({
  link,
  label,
  reason,
  missing,
}: {
  link: HarnessLink
  label: string
  /** what the probe reported when it failed — the only real answer to "why not" */
  reason?: string
  /** no agent AT ALL on this machine — see `noAgentNotice` */
  missing?: string
}) {
  // `missing` outranks the wait: there is nothing on the other end to connect to,
  // and a spinner that can never land is worse than the answer.
  const connecting = link === 'connecting' && !missing
  return (
    <div
      role="status"
      className={cn(
        'flex gap-1.5 px-3 pt-2 text-[12px]',
        missing ? 'items-start' : 'items-center',
        connecting ? 'text-muted-foreground' : 'text-destructive',
      )}
    >
      {connecting ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <TriangleAlert className={cn('h-3 w-3 shrink-0', missing && 'mt-[3px]')} />
      )}
      {/* One harness failing is a row with the rest on hover. NO harness at all is
          not a harness problem, so it gets its full sentence: truncated to "Claude
          Code is not rea…" it is exactly the line that sends people hunting for a
          fault in Studio. */}
      {missing ? (
        <span className="min-w-0 flex-1 leading-snug">{missing}</span>
      ) : (
        <span className="min-w-0 flex-1 truncate" title={connecting ? undefined : reason}>
          {connecting ? `Connecting to ${label}…` : (reason ?? `${label} is not reachable`)}
        </span>
      )}
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
  bar,
  expanded,
  onFocus,
  trailing,
}: {
  /** Be the dock's bar: one line, in the frame you were given, drawing none of its own. */
  bar?: boolean
  /** Bar only — the conversation above is open, so the row can afford the rest of itself. */
  expanded?: boolean
  onFocus?: () => void
  /** An extra control for the row — the dock's own way back to the comment threads. */
  trailing?: ReactNode
}) {
  const { data: chats } = useChats()
  const openChats = chats?.chats ?? []
  const chat = chatOf(openChats, chats?.activeId)
  const { data: harness } = useHarness()
  const run = useDisplayRun(chats?.activeId)
  const chatId = chat?.id
  // The draft lives in the store, keyed by chat: re-docking the panel unmounts the
  // composer and a half-written message must survive that — and a message is written
  // TO an agent, so it stays on the tab it was written on. Switching tabs therefore
  // shows that tab's own draft, which is empty until you write one there.
  const text = useUI((state) => agentDraftOf(state.agentDrafts, chatId))
  const setDraft = useUI((state) => state.setAgentDraft)
  const adoptDraft = useUI((state) => state.adoptAgentDraft)
  const setText = useCallback((next: string) => setDraft(chatId, next), [setDraft, chatId])
  const [pending, setPending] = useState<PendingSend[]>([])
  const ticket = useRef(0)
  const field = useRef<HTMLTextAreaElement>(null)
  const snapshot = useAgentSnapshot(chatId)
  const setRun = useAgentLive((state) => state.setRun)
  const dropRun = useAgentLive((state) => state.dropRun)
  const { attached } = useAttachedComments()
  const { images, attach, detach, uploading } = useComposerImages(chatId)
  const setAttached = useUI((state) => state.setAgentComments)
  const { data: documentGroups } = useWorkspaceDocuments()
  const qc = useQueryClient()
  const active = isRunActive(run)
  // Three states, not two: an agent Studio has not REACHED yet is not an agent
  // that is not there. Both close the composer, but only one of them is over.
  const link = harnessLink(snapshot.data?.available, snapshot.isError)
  const available = link === 'ready'
  const harnessId = chat?.harness ?? snapshot.data?.harness ?? ''
  const harnessLabel = labelOf(harness, harnessId) || 'the agent'
  const presence = presenceOf(harness, harnessId)
  const unreachableReason = presence && !presence.ok ? presence.message : undefined
  // Not "this agent is down" but "there is no agent here" — a different sentence,
  // and the only one that tells the reader what to actually do.
  const noAgent = noAgentNotice(harness)
  // Attached threads and documents are themselves something to send: with either,
  // an empty composer is a valid submit that carries them as they are. Mirrors the
  // server's own rule (agent/run/preparation.ts), which only rejects an empty turn.
  const awaiting = attached.length
  const documentCount = countDocuments(documentGroups)
  // Not while a turn runs, though — they go with whatever turn starts next, so an
  // empty composer would queue a blank message to say so. And not before the chips
  // are on screen: a resting bar shows one line, so a send button on an empty field
  // would be a turn nobody could see.
  const payloadShowing = !bar || !!expanded
  const carriesPayload = payloadShowing && !active && (awaiting > 0 || documentCount > 0)
  const sendsPayload = carriesPayload && !text.trim() && !images.length
  const sendable = !!text.trim() || images.length > 0 || carriesPayload
  // an image still on its way up has no id to send yet — the message waits for it
  const canSend = available && sendable && !uploading

  // Grow with the content before paint, up to half the panel. In the bottom dock
  // the composer's height positions the whole frame; waiting for a passive effect
  // would briefly leave the frame at its previous bounds while the textarea had
  // already accepted the new value.
  // The resting bar is one line whatever the draft holds: it shows a preview of
  // it instead, and the field only grows once the dock is open.
  const resting = !!bar && !expanded
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    if (!resting) el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [text, resting])

  // The composer is on screen before `GET /agent/chats` answers, so the first
  // keystrokes have no chat to belong to yet. When one arrives, it takes them.
  useEffect(() => {
    if (chatId) adoptDraft(chatId)
  }, [chatId, adoptDraft])

  // A failed send must never be the reason a message is gone: nothing typed
  // since gets it back as it was, something typed gets it in front of that. It
  // comes back to the chat it was sent from, which is not necessarily the one
  // being looked at when the failure lands.
  const restore = (message: string, error: string, sentChatId?: string) => {
    toast.error(error)
    if (!message) return
    // the draft lives in the store, so read what is there NOW rather than closing
    // over the render that started the send
    const current = agentDraftOf(useUI.getState().agentDrafts, sentChatId)
    setDraft(sentChatId, current.trim() ? `${message}\n\n${current}` : message)
  }

  // The images come back the same way: to the chat they were sent from, in front
  // of any pasted since.
  const restoreImages = (attachments: ChatAttachment[], sentChatId?: string) => {
    if (attachments.length && sentChatId) useDraftImages.getState().restore(sentChatId, attachments)
  }

  // A pasted image goes with the message. Pasted TEXT always wins, though: an
  // office app puts a picture of the selection on the clipboard beside the text,
  // and it is the text that was copied. Only a file's own name (what a file
  // manager adds) does not count as text.
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter(isImageFile)
    if (!files.length) return
    const text = event.clipboardData.getData('text/plain').trim()
    if (text && !files.every((file) => text.includes(file.name))) return
    event.preventDefault()
    attach(files)
  }

  // The server parked the message; show it on the tab it belongs to now, rather
  // than a refetch later — the refresh below reconciles either way.
  const landQueued = (message: QueuedMessage) => {
    if (!chatId) return
    qc.setQueryData<ChatList>(qk.chats, (current) =>
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

  // what an empty send is carrying, in the words the run itself will use
  const carriedLabel =
    awaiting > 0
      ? `${awaiting} attached thread${awaiting === 1 ? '' : 's'}`
      : `${documentCount} document${documentCount === 1 ? '' : 's'}`

  /**
   * Send what is typed — as a turn if the chat is free, into the queue if not.
   *
   * The field empties on the KEYSTROKE, not on the answer: a submit builds the
   * domain bundle and probes the harness before it replies, and a composer that
   * holds the text until then reads as an Enter that never registered. What
   * takes its place says which of the two happened — a turn at the foot of the
   * conversation, or a row in the queue strip — so the message is visible the
   * whole way, and comes back to the field if the send failed.
   *
   * A free chat therefore never shows a queue: queueing is what a BUSY chat does
   * with a message, and saying it of an idle one only made the send look refused.
   */
  const send = () => {
    if (!canSend) return
    const message = text.trim()
    const comments = attached
    const sentImages = chatId
      ? useDraftImages
          .getState()
          .take(chatId)
          .flatMap((image) => (image.attachment ? [image.attachment] : []))
      : []
    const label = message || (sentImages.length ? imagesLabel(sentImages.length) : carriedLabel)
    const id = `pending-${(ticket.current += 1)}`
    const started =
      active || !chatId
        ? null
        : pendingRun({
            id,
            chatId,
            harness: chat?.harness ?? '',
            message,
            summary: label,
            attachments: sentImages,
          })
    setText('')
    // the pick goes with this message; the next one starts from nothing attached again
    setAttached([])
    if (started) setRun(started)
    else setPending((current) => [...current, { id, label, chatId }])
    // take back whatever this send put up — a turn the server never confirmed, or
    // the queue row that stood for it
    const drop = () => {
      if (started) dropRun(started.chatId, started.id)
      else setPending((current) => current.filter((row) => row.id !== id))
    }
    const refresh = () => {
      qc.invalidateQueries({ queryKey: qk.agent(chatId) })
      qc.invalidateQueries({ queryKey: qk.chats })
    }
    // a failed send gives back everything it took: the text, the images, and the
    // threads too, unless a new pick replaced them
    const giveBack = (error: string) => {
      restore(message, error, chatId)
      restoreImages(sentImages, chatId)
      if (comments.length && useUI.getState().agentComments.length === 0) setAttached(comments)
    }
    const ids = sentImages.map((attachment) => attachment.id)
    void api.agentSubmit(message, chatId, comments, ids).then(
      (result) => {
        // the real turn takes the shown one's place first, so nothing blinks out
        // between the two — `drop` then finds none of ours left to take back
        if (result.run) setRun(result.run)
        drop()
        if (result.error) giveBack(result.error)
        else if (result.queued) landQueued(result.queued)
        refresh()
      },
      (error) => {
        drop()
        giveBack(String(error))
        refresh()
      },
    )
  }

  // The draft as the resting bar shows it: its opening words, on one line.
  const draftPreview = text.trim().replace(/\s+/g, ' ')

  const composed = (
    <ComposerField
      ref={field}
      data-agent-composer=""
      value={text}
      onChange={setText}
      onSubmit={send}
      onPaste={paste}
      onFocus={onFocus}
      // One prompt, whatever the turn happens to be carrying. The chips above already
      // show the threads and the documents; saying it again here only made the field
      // read differently from one moment to the next.
      // Two altitudes, never the same sentence twice: the line above is the state
      // and the reason behind it, the field is only ever what YOU can do about it.
      // With no agent at all the resting bar is the only thing on screen, and it is
      // one line — so that line has to carry the whole answer, not a state the
      // reader then has to hover to act on. `noAgentNotice.full` says it above
      // wherever there IS a second line; this is the same sentence, shortened to
      // what fits, and never truncated further by the field's own width.
      placeholder={
        available
          ? PROMPT
          : noAgent
            ? noAgent.line
            : link === 'connecting'
              ? 'Connecting…'
              : `${harnessLabel} unavailable`
      }
      disabled={!available}
      grow={!resting}
      className={cn(
        bar ? 'block w-full px-1 py-1' : 'w-full px-3 pt-2.5',
        // under the preview: still the thing a click or a Tab lands on, which is
        // what opens the dock, but not a second copy of the same words
        resting && 'overflow-hidden',
        resting && draftPreview && 'text-transparent caret-transparent',
      )}
    />
  )

  const imageChips = <ComposerImages images={images} onRemove={detach} />

  const stop = (
    <button
      type="button"
      onClick={() =>
        void api
          .agentCancel(chatId)
          .catch((error) => toast.error(`Could not stop the agent — ${String(error)}`))
          // the turn settles a moment after the abort lands; ask the
          // server rather than waiting on the frame that says so
          .finally(() => qc.invalidateQueries({ queryKey: qk.agent(chatId) }))
      }
      title="Stop the agent"
      aria-label="Stop the agent"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-accent"
    >
      <Square className="h-3 w-3 fill-current" />
    </button>
  )

  // What the line above would have said, for the one place that has no line to
  // spare: the icon carries the state, the field's own placeholder carries what
  // it means, and the reason is one hover away. The resting bar is one line.
  const waiting = link === 'connecting' && !noAgent
  const linkSaid =
    noAgent?.full ??
    (waiting
      ? `Connecting to ${harnessLabel}…`
      : (unreachableReason ?? `${harnessLabel} is not reachable`))
  const linkMark = available ? null : (
    <span
      role="status"
      title={linkSaid}
      aria-label={linkSaid}
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center',
        waiting ? 'text-muted-foreground' : 'text-destructive',
      )}
    >
      {waiting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <TriangleAlert className="h-3.5 w-3.5" />
      )}
    </span>
  )

  const sendTitle = () => {
    if (noAgent) return noAgent.full
    if (link === 'connecting') return `Connecting to ${harnessLabel} — nothing can be sent yet`
    if (!available) return unreachableReason ?? `${harnessLabel} is not reachable`
    if (uploading) return 'Waiting for the images to finish uploading'
    if (active) return 'Queue for when this turn ends (↵)'
    return sendsPayload ? 'Send what the composer carries (↵)' : 'Send (↵)'
  }

  const submit = (
    <SendButton
      onClick={send}
      disabled={!canSend}
      title={sendTitle()}
      label={active ? 'Queue message' : 'Send'}
    >
      {/* nothing can leave until the handshake lands, and the button is where the
          hand already is — so it is the button that spins, not just the row above.
          Not when there is no agent to hand shake WITH, though: that one never
          lands. Nothing to say is the plain arrow, which is what SendButton draws. */}
      {waiting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : active ? (
        <ListPlus className="h-4 w-4" />
      ) : undefined}
    </SendButton>
  )

  const queue = (
    <MessageQueue
      chatId={chatId}
      queued={chat?.queued ?? NO_QUEUE}
      // one composer serves every tab, so a send still on the wire must not
      // show up under the queue of the tab you switched to meanwhile
      pending={pending.filter((entry) => entry.chatId === chatId)}
      running={active}
    />
  )
  // below the payload and above the field: the last thing read before the caret,
  // because it is the thing that decides whether the caret matters
  const linkStatus = !available && (
    <LinkStatus
      link={link}
      label={harnessLabel}
      reason={unreachableReason}
      missing={noAgent?.full}
    />
  )

  // The dock's bar. Resting it is ONE line: the clip, the draft's opening words,
  // and only what is worth a line beside them. Open it is the panel's composer
  // laid out the same way as docked: whatever the turn carries, then the field
  // across the whole width, then the controls under it. Both are the same row
  // wrapped differently — the field keeps its place in the tree, so the focus
  // that opens the dock is never lost to a remount mid-open.
  if (bar)
    return (
      <div className="shrink-0">
        {payloadShowing && (
          <>
            {queue}
            <TurnPayload />
          </>
        )}
        {/* only once the chat is open — a resting bar has no second line to give */}
        {payloadShowing && linkStatus}
        {!resting && imageChips}
        <div
          className={cn('flex flex-wrap items-center gap-1 px-2', resting ? 'py-2' : 'pb-2 pt-1')}
        >
          <div
            className={cn(
              'relative min-w-0 flex-1',
              resting ? 'order-2' : 'order-first basis-full',
            )}
          >
            {composed}
            {resting && draftPreview && (
              <span
                aria-hidden
                data-draft-preview=""
                className="pointer-events-none absolute inset-0 truncate px-1 py-1 text-[14px] leading-relaxed text-foreground"
              >
                {draftPreview}
              </span>
            )}
          </div>
          <div className="order-1 flex shrink-0 items-center gap-1">
            <AttachButton onPicked={() => field.current?.focus()} />
            {resting && linkMark}
            {/* the images wait in the field's row as a count: their chips are a
                second line, and the resting bar has one */}
            {resting && images.length > 0 && (
              <span
                title={imagesLabel(images.length)}
                aria-label={`${imagesLabel(images.length)} attached`}
                className="flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-[11px] text-muted-foreground"
              >
                {uploading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ImageIcon className="h-3 w-3" />
                )}
                {images.length}
              </span>
            )}
          </div>
          <div className="order-3 ml-auto flex shrink-0 items-center gap-1">
            {/* Resting, this bar IS the agent on screen — nothing else on the window
                says a turn is running, so it says so here. Opened, the transcript
                above says it better, and in more words than a line has room for. */}
            {active && resting && (
              <DockActivity
                run={run}
                harness={chat?.harness ?? ''}
                tone={toneOf(openChats, chatId, chat?.harness)}
              />
            )}
            {/* the meter sits before the model, in reading order: how hard, on what */}
            {!resting && <ChatFastToggle chat={chat} />}
            {!resting && <ChatEffortPicker chat={chat} harness={harness} />}
            {!resting && <ChatModelPicker chat={chat} harness={harness} />}
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
      {queue}
      <ComposerFrame>
        <TurnPayload />
        {linkStatus}
        {imageChips}
        {composed}
        <div className="flex items-center gap-1 px-2 pb-2">
          <AttachButton onPicked={() => field.current?.focus()} />
          <div className="ml-auto flex items-center gap-1.5">
            <ChatFastToggle chat={chat} />
            {/* the meter sits before the model, in reading order: how hard, on what */}
            <ChatEffortPicker chat={chat} harness={harness} />
            <ChatModelPicker chat={chat} harness={harness} />
            {trailing}
            {/* Stop and Send are both live while a turn runs: one ends what the
                agent is doing, the other lines up what it does next, and needing
                the first to reach the second is what the queue exists to undo. */}
            {active && stop}
            {submit}
          </div>
        </div>
      </ComposerFrame>
    </div>
  )
}
