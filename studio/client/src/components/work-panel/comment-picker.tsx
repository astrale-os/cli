import type { Comment, DomainSummary } from '@shared/types'

import { Check, MessageSquare, Paperclip } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { anchorLabel, threadsAwaitingAgent } from '@/lib/comments'
import { useWorkspaceComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { CHIP } from './documents'

interface AwaitingGroup {
  domain: DomainSummary
  threads: Comment[]
}

/**
 * The open threads the next turn COULD carry, and the ones it will.
 *
 * Open threads are not sent on their own: a message about something else must not
 * drag every pending question along. They are signalled beside the composer, and
 * the user picks which ones go. `attached` is the pick, narrowed to the threads that
 * still await the agent — one answered or resolved since simply drops out of it.
 */
export function useAttachedComments(): {
  groups: AwaitingGroup[]
  awaiting: number
  attached: string[]
} {
  const { data } = useWorkspaceComments()
  const chosen = useUI((state) => state.agentComments)
  const groups = data
    .map((group) => ({
      domain: group.domain,
      threads: threadsAwaitingAgent(group.store?.comments),
    }))
    .filter((group) => group.threads.length > 0)
  const ids = new Set(groups.flatMap((group) => group.threads.map((thread) => thread.id)))
  return {
    groups,
    awaiting: ids.size,
    attached: chosen.filter((id) => ids.has(id)),
  }
}

/** A thread's latest word, or its first when the latest says nothing. */
export function threadText(comment: Comment): string {
  return (comment.thread.at(-1)?.text ?? comment.thread[0]?.text ?? '').trim() || 'Empty thread'
}

/**
 * One chip for the open threads: muted while none is attached — it only says they
 * are there — and primary once some are. Either way it opens the picker, where each
 * thread can be attached to the next turn or left out.
 */
export function CommentPicker() {
  const { groups, awaiting, attached } = useAttachedComments()
  const setAttached = useUI((state) => state.setAgentComments)
  const setPanelTab = useUI((state) => state.setPanelTab)
  const [open, setOpen] = useState(false)
  if (awaiting === 0) return null

  const selected = new Set(attached)
  const toggle = (id: string) =>
    setAttached(selected.has(id) ? attached.filter((entry) => entry !== id) : [...attached, id])
  const all = groups.flatMap((group) => group.threads.map((thread) => thread.id))
  const plural = awaiting === 1 ? '' : 's'
  const label =
    attached.length === 0
      ? `${awaiting} open comment${plural}`
      : attached.length === awaiting
        ? `${awaiting} comment${plural} attached`
        : `${attached.length} of ${awaiting} comments attached`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="comment-picker"
          title={
            attached.length === 0
              ? `Not sent to the agent — click to attach ${awaiting === 1 ? 'it' : 'some'} to your next message`
              : 'The agent answers the attached threads on its next turn — click to change'
          }
          className={cn(
            CHIP,
            'gap-1.5 pr-2.5 transition-colors',
            attached.length === 0
              ? 'border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
          )}
        >
          {attached.length === 0 ? (
            <MessageSquare className="h-3 w-3 shrink-0" />
          ) : (
            <Paperclip className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <p className="min-w-0 flex-1 text-[12px] font-medium">Attach to the next message</p>
          <button
            type="button"
            onClick={() => setAttached(attached.length === awaiting ? [] : all)}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {attached.length === awaiting ? 'None' : 'All'}
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {groups.map(({ domain, threads }) => (
            <section key={domain.id}>
              {groups.length > 1 && (
                <p className="truncate px-3 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {domain.origin}
                </p>
              )}
              {threads.map((thread) => {
                const on = selected.has(thread.id)
                return (
                  <button
                    key={thread.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => toggle(thread.id)}
                    className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                      )}
                    >
                      {on && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px]">{threadText(thread)}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {anchorLabel(thread.anchorRefs[0]?.ref ?? '')}
                      </span>
                    </span>
                  </button>
                )
              })}
            </section>
          ))}
        </div>
        <div className="border-t px-3 py-1.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setPanelTab('comments')
            }}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open the comments tab
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
