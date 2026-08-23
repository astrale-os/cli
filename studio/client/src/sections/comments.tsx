import type { Comment, ThreadEntry } from '@shared/types'

import { Check, ClipboardCopy, GitMerge, HelpCircle, MessageSquare, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { CopyDialog, MergeDialog } from '@/components/copy-merge'
import { Chip, EmptyState, Row, SectionShell, Surface } from '@/components/studio-kit'
import { ChoiceOptions, EntryText } from '@/components/thread-popover'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useCommentMutations, useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

function anchorLabel(ref: string): string {
  if (ref === 'section.schema') return 'Schema canvas'
  if (ref.startsWith('view.')) return `View · ${ref.slice('view.'.length)}`
  if (ref.startsWith('module.')) return `Module · ${ref.slice('module.'.length)}`
  if (ref.startsWith('class.')) return `Class · ${ref.slice('class.'.length)}`
  if (ref.startsWith('edge.')) return `Edge · ${ref.slice('edge.'.length)}`
  if (ref.startsWith('section.')) return ref.slice('section.'.length).replace(/\./g, ' · ')
  return ref
}

export function CommentsSection({ domainId }: { domainId: string }) {
  const { data: store, isLoading } = useComments(domainId)
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const setCopyOpen = useUI((state) => state.setCopyOpen)
  const setMergeOpen = useUI((state) => state.setMergeOpen)

  const subtitle =
    'Pin notes to any element, then Submit to the agent — it edits the code and replies here.'

  if (isLoading) {
    return (
      <SectionShell
        title="Comments"
        subtitle={subtitle}
        icon={<MessageSquare className="h-5 w-5" />}
      >
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading comments…
        </div>
      </SectionShell>
    )
  }

  const comments = store?.comments ?? []
  const open = comments.filter((c) => c.status === 'open')
  const closed = comments.filter((c) => c.status === 'closed')
  const shown = tab === 'open' ? open : closed

  const segments: { key: 'open' | 'closed'; label: string; count: number }[] = [
    { key: 'open', label: 'Open', count: open.length },
    { key: 'closed', label: 'Resolved', count: closed.length },
  ]

  return (
    <>
      <SectionShell
        title="Comments"
        subtitle={subtitle}
        icon={<MessageSquare className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)}>
              <ClipboardCopy className="h-3.5 w-3.5" />
              Copy for agent
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
              <GitMerge className="h-3.5 w-3.5" />
              Merge reply
            </Button>
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
              {segments.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setTab(s.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium transition-colors',
                    tab === s.key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s.label}
                  <span
                    className={cn(
                      'text-xs',
                      tab === s.key ? 'text-muted-foreground' : 'text-muted-foreground/60',
                    )}
                  >
                    {s.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        }
      >
        {shown.length === 0 ? (
          <Surface>
            <EmptyState
              icon={<MessageSquare />}
              title={tab === 'open' ? 'No open threads' : 'No resolved threads yet'}
              hint={
                tab === 'open'
                  ? 'Hover any element and click the comment icon to start one.'
                  : undefined
              }
            />
          </Surface>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((c) => (
              <CommentCard key={c.id} domainId={domainId} comment={c} />
            ))}
          </div>
        )}
      </SectionShell>
      <CopyDialog />
      <MergeDialog />
    </>
  )
}

function ThreadEntryView({
  entry,
  commentId,
  open,
  isLast,
  domainId,
}: {
  entry: ThreadEntry
  commentId: string
  open: boolean
  isLast: boolean
  domainId: string
}) {
  const isAgent = entry.role === 'author'
  const answerable = entry.type === 'choice' && !!entry.options && isAgent && open && isLast
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-0.5 text-[13px] leading-relaxed">
        <span
          className={cn(
            'text-[11px] font-semibold uppercase tracking-wider',
            isAgent ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {isAgent ? 'agent' : 'you'}
        </span>
        <EntryText commentId={commentId} entryId={entry.id} text={entry.text} />
      </div>
      {entry.type === 'choice' &&
        entry.options &&
        (answerable ? (
          <ChoiceOptions commentId={commentId} options={entry.options} domainId={domainId} />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {entry.options.map((o) => (
              <Chip key={o} tone={entry.answer === o ? 'primary' : 'outline'}>
                {o}
              </Chip>
            ))}
          </div>
        ))}
    </div>
  )
}

function CommentCard({ domainId, comment }: { domainId: string; comment: Comment }) {
  const { reply, setStatus, remove } = useCommentMutations(domainId)
  const [text, setText] = useState('')
  const anchor = comment.anchorRefs[0]

  return (
    <Surface className={cn('overflow-hidden', comment.status === 'closed' && 'opacity-70')}>
      {/* Header row */}
      <Row
        className="border-b py-3"
        leading={<MessageSquare className="h-4 w-4 text-muted-foreground/70" />}
        trailing={
          <button
            type="button"
            title="Remove thread"
            onClick={() => remove.mutate(comment.id, { onSuccess: () => toast.success('Deleted') })}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover/row:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        }
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Chip tone={comment.status === 'open' ? 'primary' : 'default'}>{comment.status}</Chip>
          {comment.orphaned && <Chip tone="danger">orphaned</Chip>}
          {anchor && (
            <span className="truncate text-xs text-muted-foreground/70" title={anchor.ref}>
              {anchorLabel(anchor.ref)}
            </span>
          )}
        </div>
      </Row>

      {/* Thread */}
      <div className="flex flex-col gap-3 px-4 py-3.5">
        {comment.thread.map((t, i) => (
          <ThreadEntryView
            key={t.id}
            entry={t}
            commentId={comment.id}
            open={comment.status === 'open'}
            isLast={i === comment.thread.length - 1}
            domainId={domainId}
          />
        ))}
      </div>

      {/* Reply + resolve, open threads only */}
      {comment.status === 'open' && (
        <div className="flex flex-col gap-2.5 border-t px-4 py-3">
          <Textarea
            className="min-h-16 resize-none font-sans text-[13px]"
            placeholder="Reply…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                setStatus.mutate(
                  { commentId: comment.id, status: 'closed' },
                  { onSuccess: () => toast.success('Resolved') },
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <Check className="h-3.5 w-3.5" />
              Resolve
            </button>
            <button
              type="button"
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary/12 px-3 py-1.5 text-[13px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              Reply
            </button>
          </div>
        </div>
      )}
    </Surface>
  )
}
