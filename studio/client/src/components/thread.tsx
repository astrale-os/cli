import type { AnchorRef, Comment, ThreadEntry } from '@shared/types'

import { Bot, Check, Pencil, Trash2, User } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useAgentSnapshot } from '@/lib/agent'
import { useCommentMutations } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { Markdown } from './markdown'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

/**
 * One comment thread, rendered the same way wherever it appears (canvas pin,
 * detail pane, work panel).
 *
 * At rest a thread shows only what was said plus two quiet actions. The reply
 * field appears when you ask for it — a permanently open textarea under every
 * thread is noise, and there is usually more than one thread on screen.
 */

/** Unsent text (per thread, and per anchor for a new comment) — survives closing a popover. */
const drafts = new Map<string, string>()

export function hasAnyUnsentDraft(): boolean {
  for (const value of drafts.values()) if (value.trim()) return true
  return false
}

/** Is there unsent text in this anchor's composer (new comment or any reply)? */
export function hasUnsentDraft(anchorRef: string, threads: Comment[]): boolean {
  for (const [key, value] of drafts) {
    if (!value.trim()) continue
    if (key.startsWith('new::') && key.endsWith(`::${anchorRef}`)) return true
    if (threads.some((thread) => key === `reply::${thread.id}`)) return true
  }
  return false
}

function useDraft(key: string): [string, (value: string) => void, () => void] {
  const [value, setValue] = useState(() => drafts.get(key) ?? '')
  const update = (next: string) => {
    setValue(next)
    if (next) drafts.set(key, next)
    else drafts.delete(key)
  }
  return [value, update, () => update('')]
}

/** "just now" · "12 min ago" · "3 h ago" · "2 d ago" · "19 Aug". */
function relativeTime(iso: string): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days} d ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Who wrote an entry: you, or the local agent (named after the harness handling it). */
function useSpeaker(domainId: string): (role: ThreadEntry['role']) => string {
  const harness = useAgentSnapshot(domainId).data?.harness
  const agent = harness ? harness.charAt(0).toUpperCase() + harness.slice(1) : 'Agent'
  return (role) => (role === 'author' ? agent : 'You')
}

function Avatar({ role }: { role: ThreadEntry['role'] }) {
  const agent = role === 'author'
  return (
    <span
      className={cn(
        'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full',
        agent ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
      {agent ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
    </span>
  )
}

/** A thread entry's text with inline editing — hover reveals a pencil. */
export function EntryText({
  domainId,
  commentId,
  entryId,
  text,
}: {
  domainId?: string
  commentId: string
  entryId: string
  text: string
}) {
  const activeDomainId = useUI((s) => s.domainId)
  const { edit } = useCommentMutations(domainId ?? activeDomainId ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)

  const save = () => {
    const value = draft.trim()
    if (!value || edit.isPending) return
    edit.mutate({ commentId, entryId, text: value }, { onSuccess: () => setEditing(false) })
  }

  if (editing) {
    return (
      <div className="mt-1 space-y-1.5">
        <Textarea
          autoFocus
          className="min-h-16 text-[13px]"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(text)
              setEditing(false)
            }
          }}
        />
        <div className="flex justify-end gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setDraft(text)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
          <Button size="xs" disabled={!draft.trim() || edit.isPending} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="group/entry relative">
      <Markdown text={text} />
      <button
        type="button"
        title="Edit"
        onClick={() => {
          setDraft(text)
          setEditing(true)
        }}
        className="absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded text-transparent transition-colors group-hover/entry:bg-card group-hover/entry:text-muted-foreground hover:!text-foreground"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  )
}

/**
 * The agent can attach `options` to a question. Choosing posts a normal user
 * reply with the chosen text, so the agent sees the decision next turn.
 */
export function ChoiceOptions({
  commentId,
  options,
  domainId,
}: {
  commentId: string
  options: string[]
  domainId: string
}) {
  const { reply } = useCommentMutations(domainId)
  const [other, setOther] = useState('')
  const [showOther, setShowOther] = useState(false)

  const pick = (choice: string) => {
    const value = choice.trim()
    if (!value || reply.isPending) return
    reply.mutate(
      { commentId, entry: { role: 'user', type: 'text', text: value } },
      {
        onSuccess: () => {
          setOther('')
          setShowOther(false)
        },
      },
    )
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={reply.isPending}
          onClick={() => pick(option)}
          className="rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors hover:border-primary hover:bg-primary/10 disabled:opacity-50"
        >
          {option}
        </button>
      ))}
      {showOther ? (
        <span className="inline-flex items-center gap-1">
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by an explicit click
            autoFocus
            value={other}
            onChange={(event) => setOther(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                pick(other)
              }
            }}
            placeholder="Your answer…"
            className="h-7 w-36 rounded-md border bg-card px-2 text-[12px] outline-none focus:border-ring"
          />
          <Button size="xs" disabled={!other.trim() || reply.isPending} onClick={() => pick(other)}>
            Send
          </Button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setShowOther(true)}
          className="rounded-full px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Other…
        </button>
      )}
    </div>
  )
}

/** The entries of one thread: who said what, in order. */
function Entries({ domainId, comment }: { domainId: string; comment: Comment }) {
  const speaker = useSpeaker(domainId)
  return (
    <div className="space-y-2.5">
      {comment.thread.map((entry, index) => {
        const answerable =
          entry.type === 'choice' &&
          !!entry.options &&
          entry.role === 'author' &&
          comment.status === 'open' &&
          index === comment.thread.length - 1
        return (
          <div key={entry.id} className="flex gap-2">
            <Avatar role={entry.role} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-medium">{speaker(entry.role)}</span>
                {index === 0 && (
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(comment.createdAt)}
                  </span>
                )}
              </div>
              <div className="text-[13px] leading-snug">
                <EntryText
                  domainId={domainId}
                  commentId={comment.id}
                  entryId={entry.id}
                  text={entry.text}
                />
              </div>
              {entry.type === 'choice' &&
                entry.options &&
                (answerable ? (
                  <ChoiceOptions
                    commentId={comment.id}
                    options={entry.options}
                    domainId={domainId}
                  />
                ) : (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {entry.options.map((option) => (
                      <Badge key={option} variant={entry.answer === option ? 'default' : 'outline'}>
                        {option}
                      </Badge>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** One thread: what was said, then Reply / Resolve. */
export function ThreadView({ domainId, comment }: { domainId: string; comment: Comment }) {
  const { reply, setStatus, remove } = useCommentMutations(domainId)
  const [text, setText, clearText] = useDraft(`reply::${comment.id}`)
  const [replying, setReplying] = useState(() => !!text)
  const closed = comment.status === 'closed'

  const send = () => {
    const value = text.trim()
    if (!value || reply.isPending) return
    reply.mutate(
      { commentId: comment.id, entry: { role: 'user', type: 'text', text: value } },
      {
        onSuccess: () => {
          clearText()
          setReplying(false)
        },
      },
    )
  }

  return (
    <div className="group/thread space-y-2">
      <div className={cn(closed && 'opacity-70')}>
        <Entries domainId={domainId} comment={comment} />
      </div>

      {replying && !closed ? (
        <div className="flex gap-2">
          <Avatar role="user" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Textarea
              // biome-ignore lint/a11y/noAutofocus: opened by an explicit Reply click
              autoFocus
              className="min-h-16 text-[13px]"
              placeholder="Reply…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setReplying(false)
              }}
            />
            <div className="flex justify-end gap-1">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  clearText()
                  setReplying(false)
                }}
              >
                Cancel
              </Button>
              <Button size="xs" disabled={!text.trim() || reply.isPending} onClick={send}>
                Reply
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1 pl-7">
          {closed ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setStatus.mutate({ commentId: comment.id, status: 'open' })}
            >
              Reopen
            </Button>
          ) : (
            <>
              <Button size="xs" variant="secondary" onClick={() => setReplying(true)}>
                Reply
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setStatus.mutate(
                    { commentId: comment.id, status: 'closed' },
                    { onSuccess: () => toast.success('Resolved') },
                  )
                }
              >
                <Check className="h-3.5 w-3.5" /> Resolve
              </Button>
            </>
          )}
          <button
            type="button"
            title="Delete this thread"
            disabled={remove.isPending}
            onClick={() => remove.mutate(comment.id)}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover/thread:opacity-100 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

/** The composer for a NEW thread on an anchor. */
export function NewComment({
  domainId,
  anchor,
  excerpt,
  autoFocus,
  onDone,
  onCancel,
}: {
  domainId: string
  anchor: AnchorRef
  excerpt: string
  autoFocus?: boolean
  onDone: () => void
  onCancel?: () => void
}) {
  const { create } = useCommentMutations(domainId)
  const [text, setText, clearText] = useDraft(`new::${domainId}::${anchor.ref}`)

  const submit = () => {
    const value = text.trim()
    if (!value || create.isPending) return
    create.mutate(
      {
        anchors: [excerpt],
        anchorRefs: [anchor],
        text: value,
        firstRole: 'user',
        type: 'text',
      },
      {
        onSuccess: () => {
          clearText()
          onDone()
        },
      },
    )
  }

  return (
    <div className="flex gap-2">
      <Avatar role="user" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Textarea
          // biome-ignore lint/a11y/noAutofocus: the composer IS the point of this popover
          autoFocus={autoFocus}
          className="min-h-16 text-[13px]"
          placeholder="Note for the agent…"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex justify-end gap-1">
          {onCancel && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                clearText()
                onCancel()
              }}
            >
              Cancel
            </Button>
          )}
          <Button size="xs" disabled={!text.trim() || create.isPending} onClick={submit}>
            Comment
          </Button>
        </div>
      </div>
    </div>
  )
}
