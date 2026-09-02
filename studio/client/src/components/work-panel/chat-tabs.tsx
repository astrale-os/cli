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
}: {
  chats: ChatInfo[]
  activeId?: string
  harness?: HarnessStatus
}) {
  const { open, select, close, update } = useChatMutations()
  const strip = useRef<HTMLDivElement>(null)
  const edges = useSideScroll(strip, chats.length)
  const tones = chatTones(chats)

  return (
    <div className="flex shrink-0 items-center gap-1 border-b px-1.5 py-1">
      <div
        ref={strip}
        // native scrollbar hidden on purpose: the strip is one row high, and a
        // 10px gutter under it would cost more than the tabs themselves
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          maskImage: `linear-gradient(to right, transparent 0, black ${edges.left ? FADE : 0}px, black calc(100% - ${edges.right ? FADE : 0}px), transparent 100%)`,
        }}
      >
        {chats.map((chat, index) => (
          <Tab
            key={chat.id}
            chat={chat}
            active={chat.id === activeId}
            tone={tones[index]!}
            harnessLabel={labelOf(harness, chat.harness)}
            onSelect={() => select.mutate(chat.id)}
            onRename={(title) => update.mutate({ chatId: chat.id, title })}
            onClose={chats.length > 1 ? () => close.mutate(chat.id) : undefined}
          />
        ))}
      </div>

      <button
        type="button"
        title="New chat"
        aria-label="New chat"
        disabled={open.isPending}
        onClick={() => open.mutate(undefined)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
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
): { left: boolean; right: boolean } {
  const [edges, setEdges] = useState({ left: false, right: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
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
  }, [ref, count])

  return edges
}

function Tab({
  chat,
  active,
  tone,
  harnessLabel,
  onSelect,
  onRename,
  onClose,
}: {
  chat: ChatInfo
  active: boolean
  tone: ChatTone
  harnessLabel: string
  onSelect: () => void
  onRename: (title: string) => void
  onClose?: () => void
}) {
  const [editing, setEditing] = useState(false)
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
      className={cn(
        'flex h-7 shrink-0 items-center rounded-md transition-colors',
        active ? tone.surface : 'hover:bg-accent/60',
      )}
    >
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
          className="h-full w-[150px] min-w-0 bg-transparent px-2 text-[12px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          // renaming needs the title in view, and only the open tab shows one
          onDoubleClick={() => active && setEditing(true)}
          aria-current={active ? 'page' : undefined}
          // the spin is the only thing that says "working", and it says nothing
          // to a screen reader or to anyone who turned motion off
          aria-busy={isBusy(chat) || undefined}
          aria-label={named ? chat.title : harnessLabel}
          title={`${named ? `${chat.title} — ` : ''}${harnessLabel}${chat.model ? ` · ${chat.model}` : ''}${isBusy(chat) ? ' — running' : ''}${active ? ' — double-click to rename' : ''}`}
          className="flex h-full min-w-0 items-center gap-1.5 px-2"
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
                isBusy(chat) && 'animate-spin [animation-duration:4s]',
              )}
            />
            {/* no mark for this agent — its initials still say which one it is */}
            {!hasHarnessLogo(chat.harness) && (
              <span
                className={cn(
                  'text-[9px] font-semibold uppercase',
                  tone.mark,
                  // spinning letters read as broken, so those tabs breathe instead
                  isBusy(chat) && 'animate-pulse',
                )}
              >
                {harnessLabel.slice(0, 2)}
              </span>
            )}
            {chat.status === 'failed' && (
              <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
          </span>
          {active && named && (
            <span className="max-w-[150px] truncate text-[12px] text-foreground">{chat.title}</span>
          )}
        </button>
      )}
      {/* only on the open tab: an ✕ on every tab would double the width of each */}
      {active && !editing && onClose && (
        <button
          type="button"
          onClick={onClose}
          title="Close this chat"
          aria-label={`Close ${named ? chat.title : harnessLabel}`}
          className="mr-1 grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
