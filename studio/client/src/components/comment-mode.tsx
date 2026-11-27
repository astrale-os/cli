import { MousePointerClick, Sparkles } from 'lucide-react'
import { useEffect } from 'react'

import { useAsks } from '@/lib/ask'
import { useUI } from '@/lib/store'
import { targetAt } from '@/lib/targets'

/** The element a click would pin to — highlighted under the pointer while targeting.
 *  Mirrors `targetAt`: only stamped targets light up, never the decorative frames. */
function resolveTargetElement(target: HTMLElement | null): HTMLElement | null {
  return target?.closest<HTMLElement>('[data-anchor-ref]') ?? null
}

/**
 * "Target anything" mode, shared by Comment (hotkey C) and Ask (hotkey A). While
 * active, a capture-phase click resolves the most specific target under the pointer
 * (`targetAt`: the nearest `anchorData` stamp, on the surface clicked) and opens the
 * matching composer at the click point: a comment draft, or an Ask. Empty canvas and
 * page chrome carry no stamp and are no target. Esc exits. A read-only Domain's target
 * opens too: its composer says what it takes there.
 */
export function CommentModeOverlay() {
  const commentMode = useUI((s) => s.commentMode)
  const askMode = useUI((s) => s.askMode)
  const toggleCommentMode = useUI((s) => s.toggleCommentMode)
  const toggleAskMode = useUI((s) => s.toggleAskMode)
  const setCommentDraft = useUI((s) => s.setCommentDraft)
  const active = commentMode || askMode

  useEffect(() => {
    if (!active) return
    // one flag, one cursor: the stylesheet paints the whole window — canvas included — with
    // the pointer that says "this click lands somewhere"
    document.body.setAttribute('data-target-mode', '')
    const exit = () => (useUI.getState().askMode ? toggleAskMode(false) : toggleCommentMode(false))

    // outline what the click would target, so the pin never lands somewhere unexpected
    let highlighted: HTMLElement | null = null
    const highlight = (next: HTMLElement | null) => {
      if (next === highlighted) return
      highlighted?.removeAttribute('data-comment-target')
      highlighted = next
      highlighted?.setAttribute('data-comment-target', '')
    }
    const onMove = (e: MouseEvent) =>
      highlight(resolveTargetElement(e.target as HTMLElement | null))

    const onClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const ask = useUI.getState().askMode
      const target = targetAt(e.target as Element | null)
      exit()
      if (!target) return
      const { clientX: x, clientY: y } = e
      // open on the next frame so this click finishes before the popover mounts —
      // otherwise Radix treats the opening click as an outside-dismiss and closes it.
      if (ask) {
        // ask → an ephemeral, element-anchored side-question (client-only, not a comment)
        requestAnimationFrame(() => useAsks.getState().start(target, x, y))
      } else {
        // Hand the hover call-out to the composer before leaving targeting mode. Its
        // own lifecycle removes this marker when the popover closes, so the element
        // stays visibly tied to the note while it is being written.
        target.element.setAttribute('data-comment-draft-target', '')
        requestAnimationFrame(() => setCommentDraft({ target, x, y }))
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        exit()
      }
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousemove', onMove, true)
    return () => {
      document.body.removeAttribute('data-target-mode')
      highlight(null)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousemove', onMove, true)
    }
  }, [active, toggleCommentMode, toggleAskMode, setCommentDraft])

  if (!active) return null

  const ask = askMode
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center">
      <div className="flex items-center gap-2 rounded-full border border-primary/40 bg-card px-4 py-1.5 text-xs font-medium shadow-[0_8px_24px_-12px_rgb(0_0_0/0.25)]">
        {ask ? (
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        ) : (
          <MousePointerClick className="h-3.5 w-3.5 text-primary" />
        )}
        <span>
          {ask ? 'Ask mode — choose a domain element' : 'Comment mode — choose a domain element'}{' '}
          <kbd className="ml-1 rounded border bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>{' '}
          to exit
        </span>
      </div>
    </div>
  )
}
