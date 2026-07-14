import type { AnchorRef, Comment } from '@shared/types'

import { Check, ChevronDown, ChevronRight, Crosshair, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useCommentMutations } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { Markdown } from './markdown'
import { MetaGrid } from './studio-kit'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card'
import { Textarea } from './ui/textarea'

/**
 * The body rendered inside a comment Popover. Shows the anchor header, the
 * existing thread(s) for this anchor (with resolve + reply), and a compact
 * composer for starting a new comment.
 */
export function ThreadPopover({
  domainId,
  anchor,
  excerpt,
  threads,
  onClose,
}: {
  domainId?: string
  anchor: AnchorRef
  excerpt: string
  threads: Comment[]
  onClose: () => void
}) {
  const activeDomainId = useUI((s) => s.domainId)
  const ownerDomainId = domainId ?? activeDomainId ?? ''
  return (
    <div className="flex max-h-[calc(var(--radix-popover-content-available-height)-1.5rem)] min-h-0 flex-col gap-2 text-sm">
      {/* lean header: a small label + a subtle target affordance (hover to see the ref) */}
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {threads.length > 0
            ? `${threads.length} comment${threads.length === 1 ? '' : 's'}`
            : 'New comment'}
        </span>
        <HoverCard openDelay={120}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              title="Target"
              className="text-muted-foreground/40 transition-colors hover:text-muted-foreground"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          </HoverCardTrigger>
          <HoverCardContent className="w-auto max-w-xs">
            <MetaGrid
              items={[
                { label: 'target', value: anchor.ref },
                ...(excerpt && excerpt !== anchor.ref ? [{ label: 'on', value: excerpt }] : []),
                ...(anchor.file ? [{ label: 'file', value: anchor.file }] : []),
              ]}
            />
          </HoverCardContent>
        </HoverCard>
      </div>

      {threads.length > 0 && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {threads.map((c) => (
            <ThreadCard key={c.id} domainId={ownerDomainId} comment={c} />
          ))}
        </div>
      )}

      <Composer
        domainId={ownerDomainId}
        anchor={anchor}
        excerpt={excerpt}
        hasThreads={threads.length > 0}
        onClose={onClose}
      />
    </div>
  )
}

/**
 * A thread entry's text with inline editing — hover reveals a pencil; clicking
 * swaps in a textarea (⌘↵ / Save to commit, Esc / Cancel to discard). Single-user
 * tool, so any text entry is editable; the edit rewrites that entry in place.
 */
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
    const v = draft.trim()
    if (!v || edit.isPending) return
    edit.mutate(
      { commentId, entryId, text: v },
      {
        onSuccess: () => {
          setEditing(false)
          toast.success('Edited')
        },
        onError: (e) => toast.error(String(e)),
      },
    )
  }

  if (editing) {
    return (
      <span className="mt-1 flex items-end gap-1.5">
        <Textarea
          autoFocus
          className="min-h-8 flex-1 text-[13px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              setDraft(text)
              setEditing(false)
            }
          }}
        />
        <Button
          size="xs"
          variant="secondary"
          disabled={!draft.trim() || edit.isPending}
          onClick={save}
        >
          Save
        </Button>
      </span>
    )
  }

  return (
    <div className="group/e relative">
      <Markdown text={text} />
      <button
        type="button"
        title="Edit"
        onClick={() => {
          setDraft(text)
          setEditing(true)
        }}
        className="absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded bg-background/80 text-transparent backdrop-blur-sm transition-colors group-hover/e:text-muted-foreground/50 hover:!text-foreground"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  )
}

/** One existing comment thread rendered compactly (mirrors sections/comments.tsx). */
function ThreadCard({ domainId, comment }: { domainId: string; comment: Comment }) {
  const { reply, setStatus, remove } = useCommentMutations(domainId)
  const [text, setText] = useState('')
  const closed = comment.status === 'closed'
  const [expanded, setExpanded] = useState(!closed)
  const preview = (comment.thread.at(-1)?.text ?? comment.thread[0]?.text ?? '').trim()

  useEffect(() => {
    setExpanded(comment.status !== 'closed')
  }, [comment.status])

  return (
    <div
      className={cn('rounded-md border bg-background/40 p-2 space-y-1.5', closed && 'bg-muted/20')}
    >
      <div className="flex items-center gap-1.5">
        <Badge variant={comment.status === 'open' ? 'secondary' : 'muted'}>
          {closed ? 'resolved' : 'open'}
        </Badge>
        {comment.orphaned && <Badge variant="destructive">orphaned</Badge>}
        {closed && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {expanded ? 'Hide' : 'Show'}
          </button>
        )}
        <button
          type="button"
          title="Delete comment"
          disabled={remove.isPending}
          onClick={() => remove.mutate(comment.id, { onSuccess: () => toast.success('Deleted') })}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50',
            !closed && 'ml-auto',
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {closed && !expanded && preview && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="block w-full truncate rounded-sm px-0.5 py-0.5 text-left text-[12px] leading-snug text-muted-foreground/75 hover:text-foreground"
        >
          {preview}
        </button>
      )}

      {(!closed || expanded) && (
        <div className={cn('space-y-1', closed && 'opacity-75')}>
          {comment.thread.map((t, i) => {
            const answerable =
              t.type === 'choice' &&
              !!t.options &&
              t.role === 'author' &&
              comment.status === 'open' &&
              i === comment.thread.length - 1
            return (
              <div key={t.id} className="text-[13px] leading-snug">
                <span
                  className={cn(
                    'mb-0.5 block text-[10px] font-medium uppercase',
                    t.role === 'author' ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {t.role === 'author' ? 'agent' : 'you'}
                </span>
                <EntryText
                  domainId={domainId}
                  commentId={comment.id}
                  entryId={t.id}
                  text={t.text}
                />
                {t.type === 'choice' &&
                  t.options &&
                  (answerable ? (
                    <ChoiceOptions commentId={comment.id} options={t.options} domainId={domainId} />
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.options.map((o) => (
                        <Badge key={o} variant={t.answer === o ? 'default' : 'outline'}>
                          {o}
                        </Badge>
                      ))}
                    </div>
                  ))}
              </div>
            )
          })}
        </div>
      )}

      {comment.status === 'open' && (
        <div className="flex items-end gap-1.5 pt-0.5">
          <Textarea
            className="min-h-8 flex-1 text-[13px]"
            placeholder="Reply…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) {
                reply.mutate(
                  {
                    commentId: comment.id,
                    entry: { role: 'user', type: 'text', text: text.trim() },
                  },
                  { onSuccess: () => setText('') },
                )
              }
            }}
          />
          <div className="flex flex-col gap-1">
            <Button
              size="xs"
              variant="secondary"
              disabled={!text.trim() || reply.isPending}
              onClick={() =>
                reply.mutate(
                  {
                    commentId: comment.id,
                    entry: { role: 'user', type: 'text', text: text.trim() },
                  },
                  { onSuccess: () => setText('') },
                )
              }
            >
              Reply
            </Button>
            <Button
              size="xs"
              onClick={() =>
                setStatus.mutate(
                  { commentId: comment.id, status: 'closed' },
                  { onSuccess: () => toast.success('Resolved') },
                )
              }
            >
              <Check className="h-3 w-3" /> Resolve
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The agent can attach `options` to a question (a multiple-choice). This renders
 * them as pickable chips plus an "Other…" free-text — choosing posts a normal
 * user reply with the chosen text, so the agent sees the decision next turn.
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
    const v = choice.trim()
    if (!v || reply.isPending) return
    reply.mutate(
      { commentId, entry: { role: 'user', type: 'text', text: v } },
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
      {options.map((o) => (
        <button
          key={o}
          type="button"
          disabled={reply.isPending}
          onClick={() => pick(o)}
          className="rounded-full border border-primary/35 bg-primary/5 px-2.5 py-1 text-[12px] font-medium transition-colors hover:border-primary hover:bg-primary/15 disabled:opacity-50"
        >
          {o}
        </button>
      ))}
      {showOther ? (
        <span className="inline-flex items-center gap-1">
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                pick(other)
              }
            }}
            placeholder="Your answer…"
            className="h-7 w-36 rounded-md border bg-background px-2 text-[12px] outline-none focus:border-primary"
          />
          <Button
            size="xs"
            variant="secondary"
            disabled={!other.trim() || reply.isPending}
            onClick={() => pick(other)}
          >
            Send
          </Button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setShowOther(true)}
          className="rounded-full border border-dashed px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          Other…
        </button>
      )}
    </div>
  )
}

/** Compact composer for a new comment on this anchor. */
function Composer({
  domainId,
  anchor,
  excerpt,
  hasThreads,
  onClose,
}: {
  domainId: string
  anchor: AnchorRef
  excerpt: string
  hasThreads: boolean
  onClose: () => void
}) {
  const { create } = useCommentMutations(domainId)
  const [text, setText] = useState('')

  const submit = () => {
    if (!text.trim()) return
    create.mutate(
      {
        anchors: [excerpt],
        anchorRefs: [anchor],
        text: text.trim(),
        firstRole: 'user',
        type: 'text',
      },
      {
        onSuccess: () => {
          toast.success('Comment added')
          onClose()
        },
        onError: (e) => toast.error(String(e)),
      },
    )
  }

  return (
    <div className="shrink-0 space-y-2 border-t pt-2">
      <Textarea
        autoFocus={!hasThreads}
        className="min-h-16 text-[13px]"
        placeholder={hasThreads ? 'Add another comment…' : 'Note for the agent…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[10px] text-muted-foreground">⌘↵ to submit</span>
        <Button size="sm" onClick={submit} disabled={!text.trim() || create.isPending}>
          Add comment
        </Button>
      </div>
    </div>
  )
}
