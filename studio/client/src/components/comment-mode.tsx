import type { AnchorRef } from '@shared/types'

import { MousePointerClick, Sparkles } from 'lucide-react'
import { useEffect } from 'react'

import { useAsks } from '@/lib/asks'
import { type CommentDraft, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

function kindFor(ref: string): AnchorRef['kind'] {
  if (/^(class|interface|edge)\./.test(ref)) return 'schema'
  if (/^(module|section)\./.test(ref)) return 'section'
  if (/^file\./.test(ref)) return 'file'
  return 'free'
}

function flowPoint(target: HTMLElement, x: number, y: number): { x: number; y: number } | null {
  const flow = target.closest<HTMLElement>('.react-flow')
  const viewport = flow?.querySelector<HTMLElement>('.react-flow__viewport')
  if (!flow || !viewport) return null
  const bounds = flow.getBoundingClientRect()
  const transform = getComputedStyle(viewport).transform
  let tx = 0
  let ty = 0
  let zoom = 1
  if (transform && transform !== 'none') {
    try {
      const m = new DOMMatrixReadOnly(transform)
      tx = m.e
      ty = m.f
      zoom = m.a || 1
    } catch {
      return null
    }
  }
  const px = (x - bounds.left - tx) / zoom
  const py = (y - bounds.top - ty) / zoom
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null
  return { x: Math.round(px), y: Math.round(py) }
}

/** Resolve the most specific targetable element under the pointer (mode-agnostic). */
function resolveDraft(
  target: HTMLElement | null,
  section: string,
  mode: 'comment' | 'ask',
  x: number,
  y: number,
): CommentDraft | null {
  if (!target) return null

  // 1) an element explicitly marked commentable (detail props/methods, section items…)
  const tagged = target.closest<HTMLElement>('[data-anchor-ref]')
  if (tagged?.dataset.anchorRef) {
    const ref = tagged.dataset.anchorRef
    const excerpt = (tagged.dataset.anchorExcerpt || tagged.textContent || ref).trim().slice(0, 80)
    return { mode, anchor: { ref, kind: kindFor(ref) }, excerpt, x, y }
  }

  // 2) a graph node — a class box or a (collapsed/expanded) module box
  const node = target.closest<HTMLElement>('.react-flow__node')
  if (node) {
    const id = node.getAttribute('data-id') ?? ''
    if (id.startsWith('class.'))
      return { mode, anchor: { ref: id, kind: 'schema' }, excerpt: id.slice(6), x, y }
    if (id.startsWith('grp-')) {
      const p = id.slice(4)
      return { mode, anchor: { ref: `module.${p}`, kind: 'section' }, excerpt: p, x, y }
    }
  }

  // 3) a graph edge (relationship)
  const edge = target.closest<HTMLElement>('.react-flow__edge')
  if (edge) {
    const name = (edge.getAttribute('data-id') ?? '').replace(/^edge-/, '')
    if (name) return { mode, anchor: { ref: `edge.${name}`, kind: 'schema' }, excerpt: name, x, y }
  }

  // 4) anywhere else inside the main content (incl. empty canvas) → pinned to this section
  if (target.closest('main')) {
    const pt = flowPoint(target, x, y)
    return {
      mode,
      anchor: { ref: `section.${section}`, kind: 'section', ...(pt ?? {}) },
      excerpt: section,
      x,
      y,
    }
  }
  return null
}

/**
 * "Target anything" mode, shared by Comment (hotkey C) and Ask (hotkey A). While
 * active, a capture-phase click resolves the most specific target under the pointer
 * (a commentable element, a graph node / edge, or the section) and opens the matching
 * floating composer at the click point via `commentDraft` (carrying the mode). Esc exits.
 */
export function CommentModeOverlay() {
  const commentMode = useUI((s) => s.commentMode)
  const askMode = useUI((s) => s.askMode)
  const toggleCommentMode = useUI((s) => s.toggleCommentMode)
  const toggleAskMode = useUI((s) => s.toggleAskMode)
  const setCommentDraft = useUI((s) => s.setCommentDraft)
  const active = commentMode || askMode
  const mode: 'comment' | 'ask' = askMode ? 'ask' : 'comment'

  useEffect(() => {
    if (!active) return
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'
    const exit = () => (useUI.getState().askMode ? toggleAskMode(false) : toggleCommentMode(false))

    const onClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const st = useUI.getState()
      const m: 'comment' | 'ask' = st.askMode ? 'ask' : 'comment'
      const draft = resolveDraft(
        e.target as HTMLElement | null,
        st.section,
        m,
        e.clientX,
        e.clientY,
      )
      exit()
      if (!draft) return
      // open on the next frame so this click finishes before the popover mounts —
      // otherwise Radix treats the opening click as an outside-dismiss and closes it.
      if (draft.mode === 'ask') {
        // ask → an ephemeral, element-anchored side-question (client-only, not a comment)
        if (st.domainId)
          requestAnimationFrame(() =>
            useAsks.getState().start(st.domainId!, draft.anchor, draft.excerpt, draft.x, draft.y),
          )
      } else {
        requestAnimationFrame(() => setCommentDraft(draft))
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
    return () => {
      document.body.style.cursor = prevCursor
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [active, toggleCommentMode, toggleAskMode, setCommentDraft])

  if (!active) return null

  const ask = mode === 'ask'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center">
      <div
        className={cn(
          'flex items-center gap-2 rounded-full border bg-card/95 px-4 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur',
          ask ? 'border-violet-400/50' : 'border-primary/40',
        )}
      >
        {ask ? (
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
        ) : (
          <MousePointerClick className="h-3.5 w-3.5 text-primary" />
        )}
        <span>
          {ask
            ? 'Ask mode — click anything to ask a quick question'
            : 'Comment mode — click anything to comment'}{' '}
          <kbd className="ml-1 rounded border bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>{' '}
          to exit
        </span>
      </div>
    </div>
  )
}
