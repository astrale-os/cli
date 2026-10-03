/**
 * chat-tabs.tsx — the strip of conversations above the agent panel.
 *
 * One domain, several chats: each tab is its own transcript, model, session and
 * running turn. The strip is only navigation — what a chat RUNS is said where
 * you type it, in the composer's model picker.
 *
 * A tab is its agent's mark in its own colour, and nothing else — the title
 * belongs to the tab you are actually in. That keeps a tab about 28 pixels wide,
 * so a domain can carry a row of them; past that the strip scrolls sideways.
 *
 * Settings can stand the strip up instead: a column on the conversation's left,
 * where every tab has the room to carry the start of its title - for when you
 * keep enough chats open that telling them apart by colour stops working.
 *
 * Tabs are yours to arrange: drag one along the strip (or Alt+arrow on a focused
 * tab) and the server keeps that order, for every window. Any tab can be renamed
 * by double-clicking it, or with F2: in the strip, that opens its title in place.
 *
 * `+` asks nothing: a new tab opens on the domain's starred model, or continues
 * with the agent you are already working with when nothing is starred. Changing
 * agent is not a thing you do when OPENING a conversation — it is picking a model
 * of the other one, in the composer, once you know what you want to ask.
 */
import type { ChatInfo, HarnessStatus } from '@shared/types'

import { DEFAULT_CHAT_TITLE } from '@shared/types'
import { Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { hasHarnessLogo, HarnessLogo } from '@/components/harness-logo'
import { useAgentUnread } from '@/lib/agent-unread'
import { useChatMutations } from '@/lib/chats'
import { labelOf } from '@/lib/harnesses'
import { cn } from '@/lib/utils'

import type { ChatTone } from './chat-tone'

import { chatTones } from './chat-tone'

const isBusy = (chat: ChatInfo) => chat.status === 'running' || chat.status === 'queued'

/** How far a tab is from the strip's edge before the fade says "there is more". */
const FADE = 20

export function ChatTabs({
  chats,
  activeId,
  harness,
  vertical = false,
}: {
  chats: ChatInfo[]
  activeId?: string
  harness?: HarnessStatus
  /** a column of titled tabs on the conversation's left, rather than a strip of marks above it */
  vertical?: boolean
}) {
  const { open, select, close, reorder, update } = useChatMutations()
  const strip = useRef<HTMLDivElement>(null)
  const edges = useSideScroll(strip, chats.length, !vertical)
  const tones = chatTones(chats)
  const arrange = useArrange(chats, reorder.mutate)

  const tabs = chats.map((chat, index) => (
    <Tab
      key={chat.id}
      chat={chat}
      active={chat.id === activeId}
      tone={tones[index]!}
      harnessLabel={labelOf(harness, chat.harness)}
      vertical={vertical}
      onSelect={() => select.mutate(chat.id)}
      onRename={(title) => update.mutate({ chatId: chat.id, title })}
      onClose={chats.length > 1 ? () => close.mutate(chat.id) : undefined}
      drag={chats.length > 1 ? arrange.dragOf(chat.id) : undefined}
      onMove={chats.length > 1 ? (delta) => arrange.step(chat.id, delta) : undefined}
    />
  ))

  if (vertical)
    return (
      <nav
        aria-label="Chats"
        className="flex w-40 shrink-0 flex-col border-r"
        data-chat-tabs="left"
      >
        <div className="flex shrink-0 items-center justify-between px-2.5 pb-1 pt-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Chats
          </span>
          <NewChatButton disabled={open.isPending} onClick={() => open.mutate(undefined)} />
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2"
          onDragLeave={arrange.leave}
        >
          {tabs}
        </div>
      </nav>
    )

  return (
    <div className="flex shrink-0 items-center gap-1 border-b px-1.5 py-1">
      <div
        ref={strip}
        // native scrollbar hidden on purpose: the strip is one row high, and a
        // 10px gutter under it would cost more than the tabs themselves
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onDragLeave={arrange.leave}
        style={{
          maskImage: `linear-gradient(to right, transparent 0, black ${edges.left ? FADE : 0}px, black calc(100% - ${edges.right ? FADE : 0}px), transparent 100%)`,
        }}
      >
        {tabs}
      </div>

      <NewChatButton disabled={open.isPending} onClick={() => open.mutate(undefined)} />
    </div>
  )
}

function NewChatButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title="New chat"
      aria-label="New chat"
      disabled={disabled}
      onClick={onClick}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  )
}

/** Which side of a tab a dragged one would land on. */
type DropSide = 'before' | 'after'

/** What one tab needs to take part in a drag. */
interface TabDrag {
  /** this tab is the one being carried */
  carried: boolean
  /** where the carried tab would land, when it is over this one */
  side?: DropSide
  start: () => void
  over: (side: DropSide) => void
  drop: () => void
  end: () => void
}

/**
 * Drag a tab to another place in the strip, or step it one place with the keyboard.
 *
 * Native drag and drop, scoped to this strip: a drag only counts while one of
 * its tabs is being carried, so a file dropped on the panel is none of its business.
 */
function useArrange(chats: ChatInfo[], reorder: (order: string[]) => void) {
  const [carried, setCarried] = useState<string>()
  const [target, setTarget] = useState<{ id: string; side: DropSide }>()
  // a tab moved by the keyboard is re-inserted by React, and the DOM drops focus
  // from a node it moves, so the moved tab takes it back once it has landed
  const refocus = useRef<string>(undefined)
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = undefined
    document.querySelector<HTMLElement>(`[data-chat-tab="${CSS.escape(id)}"]`)?.focus()
  }, [chats])

  const ids = chats.map((chat) => chat.id)
  const commit = (order: string[]) => {
    if (order.some((id, index) => id !== ids[index])) reorder(order)
  }
  const reset = () => {
    setCarried(undefined)
    setTarget(undefined)
  }

  return {
    dragOf: (id: string): TabDrag => ({
      carried: carried === id,
      ...(target?.id === id && carried && carried !== id ? { side: target.side } : {}),
      start: () => setCarried(id),
      over: (side) => {
        if (carried && (target?.id !== id || target.side !== side)) setTarget({ id, side })
      },
      drop: () => {
        if (carried && carried !== id) {
          const order = ids.filter((entry) => entry !== carried)
          const at = order.indexOf(id) + (target?.side === 'after' ? 1 : 0)
          order.splice(at, 0, carried)
          commit(order)
        }
        reset()
      },
      end: reset,
    }),
    /** a drag that wanders off the strip lands nowhere */
    leave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(undefined)
    },
    step: (id: string, delta: -1 | 1) => {
      const from = ids.indexOf(id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= ids.length) return
      const order = [...ids]
      order.splice(to, 0, order.splice(from, 1)[0]!)
      refocus.current = id
      commit(order)
    },
  }
}

/**
 * Turn the wheel sideways, and report which edge still hides a tab.
 *
 * React registers `wheel` passively on its root container, so an `onWheel` prop
 * cannot call preventDefault — without it the gesture would scroll whatever
 * ancestor happens to be scrollable instead of the strip.
 */
function useSideScroll(
  ref: React.RefObject<HTMLDivElement | null>,
  count: number,
  enabled = true,
): { left: boolean; right: boolean } {
  const [edges, setEdges] = useState({ left: false, right: false })

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const measure = () =>
      setEdges({
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      })
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      event.preventDefault()
      el.scrollLeft += delta
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [ref, count, enabled])

  return edges
}

function Tab({
  chat,
  active,
  tone,
  harnessLabel,
  vertical,
  onSelect,
  onRename,
  onClose,
  drag,
  onMove,
}: {
  chat: ChatInfo
  active: boolean
  tone: ChatTone
  harnessLabel: string
  vertical: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onClose?: () => void
  /** absent when there is nothing to arrange: a single tab */
  drag?: TabDrag
  /** step this tab one place along the strip */
  onMove?: (delta: -1 | 1) => void
}) {
  const [editing, setEditing] = useState(false)
  const unread = useAgentUnread((state) => state.receipts[chat.id]?.unread ?? false)
  const field = useRef<HTMLInputElement>(null)
  const tab = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editing) field.current?.select()
  }, [editing])
  // Forking opens a tab at the end of a strip that may already overflow; landing
  // on a chat you cannot see reads as nothing having happened.
  useEffect(() => {
    if (active) tab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const named = chat.title !== DEFAULT_CHAT_TITLE
  const name = named ? chat.title : harnessLabel
  const busy = isBusy(chat)
  const failed = chat.status === 'failed'
  const commit = () => {
    const next = field.current?.value.trim() ?? ''
    setEditing(false)
    if (next && next !== chat.title) onRename(next)
  }

  return (
    <div
      ref={tab}
      // middle-click closes any tab, including the ones too narrow to carry an ✕
      onAuxClick={(event) => {
        if (event.button === 1 && onClose) {
          event.preventDefault()
          onClose()
        }
      }}
      // a title being typed is text to select, not a tab to carry
      draggable={!!drag && !editing}
      onDragStart={(event) => {
        if (!drag) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', name)
        drag.start()
      }}
      onDragOver={(event) => {
        if (!drag || drag.carried) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const box = event.currentTarget.getBoundingClientRect()
        const past = vertical
          ? event.clientY > box.top + box.height / 2
          : event.clientX > box.left + box.width / 2
        drag.over(past ? 'after' : 'before')
      }}
      onDrop={(event) => {
        if (!drag) return
        event.preventDefault()
        drag.drop()
      }}
      onDragEnd={() => drag?.end()}
      data-dragging={drag?.carried || undefined}
      className={cn(
        'relative flex h-7 shrink-0 items-center rounded-md transition-colors',
        vertical && 'group w-full',
        active ? tone.surface : 'hover:bg-accent/60',
        drag?.carried && 'opacity-40',
      )}
    >
      {/* where the carried tab would land: a bar on that edge, inside the tab so a
          scrolling strip cannot clip it */}
      {drag?.side && (
        <span
          aria-hidden
          data-drop-side={drag.side}
          className={cn(
            'pointer-events-none absolute rounded-full bg-primary',
            vertical
              ? cn('inset-x-1 h-0.5', drag.side === 'before' ? 'top-0' : 'bottom-0')
              : cn('inset-y-1 w-0.5', drag.side === 'before' ? 'left-0' : 'right-0'),
          )}
        />
      )}
      {editing ? (
        <input
          ref={field}
          defaultValue={named ? chat.title : ''}
          placeholder={harnessLabel}
          aria-label="Chat name"
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') setEditing(false)
          }}
          className={cn(
            'h-full min-w-0 bg-transparent px-2 text-[12px] outline-none',
            vertical ? 'w-full' : 'w-[150px]',
          )}
        />
      ) : (
        <button
          type="button"
          data-chat-tab={chat.id}
          onClick={onSelect}
          // the first click already opened the tab, so its title is in view to edit
          onDoubleClick={() => setEditing(true)}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              event.preventDefault()
              onSelect()
              setEditing(true)
              return
            }
            if (!onMove || !event.altKey) return
            const back = vertical ? 'ArrowUp' : 'ArrowLeft'
            const forth = vertical ? 'ArrowDown' : 'ArrowRight'
            if (event.key !== back && event.key !== forth) return
            event.preventDefault()
            onMove(event.key === back ? -1 : 1)
          }}
          aria-current={active ? 'page' : undefined}
          // the spin is the only thing that says "working", and it says nothing
          // to a screen reader or to anyone who turned motion off
          aria-busy={busy || undefined}
          aria-label={name}
          title={`${named ? `${chat.title} — ` : ''}${harnessLabel}${chat.model ? ` · ${chat.model}` : ''}${busy ? ' — running' : ''}${unread ? ' — unread reply' : ''} · double-click to rename${onMove ? ', drag to move' : ''}`}
          className={cn('flex h-full min-w-0 items-center gap-1.5 px-2', vertical && 'flex-1')}
        >
          <span className="relative grid h-3.5 w-3.5 shrink-0 place-items-center">
            {/* a running turn spins the MARK itself — a spinner ring on top of it
                would cover the one thing the tab is made of. Slower than a
                loader's second: this reads as a tab working, not as a wait. */}
            <HarnessLogo
              harness={chat.harness}
              className={cn(
                tone.mark,
                !active && 'opacity-70',
                busy && 'animate-spin [animation-duration:4s]',
              )}
            />
            {/* no mark for this agent — its initials still say which one it is */}
            {!hasHarnessLogo(chat.harness) && (
              <span
                className={cn(
                  'text-[9px] font-semibold uppercase',
                  tone.mark,
                  // spinning letters read as broken, so those tabs breathe instead
                  busy && 'animate-pulse',
                )}
              >
                {harnessLabel.slice(0, 2)}
              </span>
            )}
            {(unread || failed) && (
              <span
                aria-label={unread ? 'Unread reply' : 'Agent failed'}
                className={cn(
                  'absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full',
                  failed ? 'bg-destructive' : 'bg-success',
                )}
              />
            )}
          </span>
          {vertical ? (
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-left text-[12px]',
                active ? 'text-foreground' : 'text-muted-foreground',
                unread && !active && 'font-medium text-foreground',
              )}
            >
              {name}
            </span>
          ) : (
            active &&
            named && (
              <span className="max-w-[150px] truncate text-[12px] text-foreground">
                {chat.title}
              </span>
            )
          )}
        </button>
      )}
      {/* only on the open tab: an ✕ on every tab would double the width of each */}
      {/* in a column there is width to spare: every tab offers it, on hover */}
      {(active || vertical) && !editing && onClose && (
        <button
          type="button"
          onClick={onClose}
          title="Close this chat"
          aria-label={`Close ${name}`}
          className={cn(
            'mr-1 grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground',
            vertical && !active && 'invisible group-hover:visible group-focus-within:visible',
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
