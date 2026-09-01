/**
 * message-queue.tsx — the messages waiting behind the turn in progress.
 *
 * Typing while the agent works used to be refused; now it lines up. The strip
 * sits between the conversation and the composer because that is where the
 * question it answers is asked — "did my message go?" — and it shows the first
 * line of each, in the order they will be sent.
 *
 * Everything here is reversible until the message leaves: reorder it, rewrite
 * it, drop it. The one irreversible control is `send now`, which STOPS the turn
 * in progress to run this message instead — so it says so, in the title and in
 * the confirmation of what it interrupts.
 */
import type { QueuedMessage } from '@shared/types'

import {
  ChevronDown,
  ChevronUp,
  FastForward,
  Loader2,
  ListOrdered,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useQueueMutations } from '@/lib/queue'
import { cn } from '@/lib/utils'

/**
 * A message whose submit is still in flight.
 *
 * The composer clears the field on Enter and puts one of these here, so a send
 * is visible from the keystroke rather than from the server's answer. It has no
 * controls: what is already on the wire cannot be reordered.
 */
export interface PendingMessage {
  id: string
  /** what the row shows — the message, or what a threads-only turn carries */
  label: string
}

/** The first line is what a queue row is: enough to recognise, never a paragraph. */
export function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}

export function MessageQueue({
  domainId,
  chatId,
  queued,
  pending,
  running,
}: {
  domainId: string
  chatId?: string
  queued: QueuedMessage[]
  pending: PendingMessage[]
  /** a turn is in flight — what the queue is waiting on */
  running: boolean
}) {
  const { edit, remove, move, sendNow } = useQueueMutations(domainId, chatId)
  if (!queued.length && !pending.length) return null

  const count = queued.length + pending.length
  return (
    <div className="mb-2 rounded-lg border border-dashed bg-muted/40 p-1">
      <p className="flex items-center gap-1.5 px-1.5 pb-1 pt-0.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
        <ListOrdered className="h-3 w-3" />
        {count} queued
        {/* an idle chat with a queue means the turn was stopped — say why nothing
            is moving rather than let the strip look stuck */}
        <span className="font-normal normal-case tracking-normal">
          {running ? '· sent when this turn ends' : '· the agent is stopped'}
        </span>
      </p>
      <div className="space-y-0.5">
        {queued.map((message, index) => (
          <QueuedRow
            key={message.id}
            message={message}
            position={index + 1}
            first={index === 0}
            last={index === queued.length - 1}
            running={running}
            busy={sendNow.isPending}
            onEdit={(text) => edit.mutate({ messageId: message.id, text })}
            onRemove={() => remove.mutate(message.id)}
            onMove={(direction) => move.mutate({ messageId: message.id, direction })}
            onSendNow={() => sendNow.mutate(message.id)}
          />
        ))}
        {pending.map((message, index) => (
          <div
            key={message.id}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground"
          >
            <Position value={queued.length + index + 1} />
            <span className="min-w-0 flex-1 truncate">{message.label}</span>
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-label="Sending" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Position({ value }: { value: number }) {
  return (
    <span className="w-3 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
      {value}
    </span>
  )
}

function QueuedRow({
  message,
  position,
  first,
  last,
  running,
  busy,
  onEdit,
  onRemove,
  onMove,
  onSendNow,
}: {
  message: QueuedMessage
  position: number
  first: boolean
  last: boolean
  running: boolean
  busy: boolean
  onEdit: (text: string) => void
  onRemove: () => void
  onMove: (direction: 'up' | 'down') => void
  onSendNow: () => void
}) {
  const [editing, setEditing] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) field.current?.select()
  }, [editing])

  if (editing) {
    const commit = () => {
      const next = field.current?.value.trim() ?? ''
      setEditing(false)
      if (next && next !== message.text) onEdit(next)
    }
    return (
      <div className="flex items-start gap-2 rounded-md bg-card px-1.5 py-1">
        <Position value={position} />
        <textarea
          ref={field}
          rows={Math.min(message.text.split('\n').length, 6)}
          defaultValue={message.text}
          aria-label="Edit the queued message"
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              commit()
            }
            if (event.key === 'Escape') setEditing(false)
          }}
          className="min-w-0 flex-1 resize-none bg-transparent text-[12px] leading-relaxed outline-none"
        />
      </div>
    )
  }

  return (
    <div className="group/row flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-card">
      <Position value={position} />
      <span
        className="min-w-0 flex-1 truncate text-[12px] text-foreground"
        // the row shows one line; the whole message is one hover away
        title={message.text}
      >
        {firstLine(message.text)}
      </span>
      {/* the controls appear under the pointer, or the strip would read as a
          column of buttons rather than a list of messages. They keep their width
          at both ends of the queue: an arrow that vanishes moves the others. */}
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
        <RowAction
          icon={ChevronUp}
          label={`Move "${firstLine(message.text)}" earlier`}
          title="Send this one sooner"
          disabled={first}
          onClick={() => onMove('up')}
        />
        <RowAction
          icon={ChevronDown}
          label={`Move "${firstLine(message.text)}" later`}
          title="Send this one later"
          disabled={last}
          onClick={() => onMove('down')}
        />
        <RowAction
          icon={Pencil}
          label={`Edit "${firstLine(message.text)}"`}
          title="Edit before it is sent"
          onClick={() => setEditing(true)}
        />
        <RowAction
          icon={FastForward}
          label={`Send "${firstLine(message.text)}" now`}
          title={running ? 'Send now — stops the turn in progress' : 'Send now'}
          disabled={busy}
          onClick={onSendNow}
        />
        <RowAction
          icon={Trash2}
          label={`Delete "${firstLine(message.text)}"`}
          title="Delete without sending"
          destructive
          onClick={onRemove}
        />
      </span>
    </div>
  )
}

function RowAction({
  icon: Icon,
  label,
  title,
  disabled,
  destructive,
  onClick,
}: {
  icon: typeof ChevronUp
  label: string
  title: string
  disabled?: boolean
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={cn(
        'grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent',
        destructive && 'hover:text-destructive',
      )}
    >
      <Icon className="h-3 w-3" />
    </button>
  )
}
