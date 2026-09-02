import { MousePointerClick, Sparkles } from 'lucide-react'
import { useEffect } from 'react'

import { useAsks } from '@/lib/asks'
import { type CommentDraft, useUI } from '@/lib/store'
import {
  anchorKindForRef,
  decodeFlowNodeId,
  flowEdgeAnchorRef,
  flowEdgeOwnerDomainId,
  flowNodeAnchorRef,
  targetElementDomainId,
} from '@/lib/targets'

/** Resolve the most specific targetable element under the pointer (mode-agnostic). */
function resolveDraft(
  target: HTMLElement | null,
  mode: 'comment' | 'ask',
  x: number,
  y: number,
): CommentDraft | null {
  if (!target) return null
  const scopedDomainId = targetElementDomainId(target)

  // 1) an element explicitly marked commentable (detail props/methods, section items…)
  const tagged = target.closest<HTMLElement>('[data-anchor-ref]')
  if (tagged?.dataset.anchorRef) {
    const ref = tagged.dataset.anchorRef
    const domainId =
      tagged.dataset.anchorDomainId ?? targetElementDomainId(tagged) ?? scopedDomainId
    if (!domainId) return null
    const excerpt = (tagged.dataset.anchorExcerpt || tagged.textContent || ref).trim().slice(0, 80)
    return {
      mode,
      // An owner stamped ON the anchor wins: the rail's domain rows name a domain the
      // canvas may not be drawing at all, so there is no `data-domain-id` around them to
      // read — and falling through to unrelated selection state would file the thread
      // on the wrong one (see `anchorData`).
      domainId,
      anchor: { ref, kind: anchorKindForRef(ref) },
      excerpt,
      x,
      y,
    }
  }

  // 2) a graph node — a class box or a (collapsed/expanded) module box
  const node = target.closest<HTMLElement>('.react-flow__node')
  if (node) {
    const rawId = node.getAttribute('data-id') ?? ''
    const identity = decodeFlowNodeId(rawId)
    const ref = flowNodeAnchorRef(rawId)
    const domainId = identity.domainId ?? targetElementDomainId(node) ?? scopedDomainId
    if (!domainId) return null
    if (ref?.startsWith('class.'))
      return {
        mode,
        domainId,
        anchor: { ref, kind: 'schema' },
        excerpt: ref.slice(6),
        x,
        y,
      }
    if (ref?.startsWith('module.')) {
      const path = ref.slice('module.'.length)
      return {
        mode,
        domainId,
        anchor: { ref, kind: 'section' },
        excerpt: path,
        x,
        y,
      }
    }
  }

  // 3) a graph edge (relationship)
  const edge = target.closest<HTMLElement>('.react-flow__edge')
  if (edge) {
    const edgeId = edge.getAttribute('data-id') ?? ''
    const ref = flowEdgeAnchorRef(edgeId)
    const domainId = flowEdgeOwnerDomainId(edgeId) ?? targetElementDomainId(edge) ?? scopedDomainId
    if (ref && domainId)
      return {
        mode,
        domainId,
        anchor: { ref, kind: 'schema' },
        excerpt: ref.slice(5),
        x,
        y,
      }
  }

  // Empty canvas and generic page chrome are deliberately not targets: every
  // comment and ask belongs to a concrete domain/module/class/property/view.
  return null
}

/** The element a click would pin to — highlighted under the pointer while targeting.
 *  Mirrors `resolveDraft`: only real targets light up, never the decorative frames. */
function resolveTargetElement(target: HTMLElement | null): HTMLElement | null {
  if (!target) return null
  const tagged = target.closest<HTMLElement>('[data-anchor-ref]')
  if (tagged) return tagged
  const node = target.closest<HTMLElement>('.react-flow__node')
  if (node) {
    const rawId = node.getAttribute('data-id') ?? ''
    return flowNodeAnchorRef(rawId) ? node : null
  }
  return target.closest<HTMLElement>('.react-flow__edge')
}

/**
 * "Target anything" mode, shared by Comment (hotkey C) and Ask (hotkey A). While
 * active, a capture-phase click resolves the most specific target under the pointer
 * (a commentable element or a graph node / edge) and opens the matching
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
      const st = useUI.getState()
      const m: 'comment' | 'ask' = st.askMode ? 'ask' : 'comment'
      const draft = resolveDraft(e.target as HTMLElement | null, m, e.clientX, e.clientY)
      exit()
      if (!draft) return
      // open on the next frame so this click finishes before the popover mounts —
      // otherwise Radix treats the opening click as an outside-dismiss and closes it.
      if (draft.mode === 'ask') {
        // ask → an ephemeral, element-anchored side-question (client-only, not a comment)
        requestAnimationFrame(() =>
          useAsks.getState().start(draft.domainId, draft.anchor, draft.excerpt, draft.x, draft.y),
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

  const ask = mode === 'ask'
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
