import { Loader2, Minus, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { type AskEntry, useAsks } from '@/lib/asks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { Button } from './ui/button'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'
import { Textarea } from './ui/textarea'

/** Top-right corner of the ask's target element on screen, or the click point if it's
 *  not currently rendered (e.g. a section/canvas anchor, or scrolled out of view). */
function locate(entry: AskEntry): { x: number; y: number } {
  const ref = entry.ref
  let el: Element | null = null
  try {
    if (ref.startsWith('module.'))
      el = document.querySelector(`.react-flow__node[data-id="grp-${ref.slice(7)}"]`)
    else if (ref.startsWith('edge.'))
      el = document.querySelector(`.react-flow__edge[data-id="edge-${ref.slice(5)}"]`)
    else
      el =
        document.querySelector(`.react-flow__node[data-id="${ref}"]`) ||
        document.querySelector(`[data-anchor-ref="${ref}"]`)
  } catch {
    el = null
  }
  if (el) {
    const r = el.getBoundingClientRect()
    if ((r.width || r.height) && r.bottom > 0 && r.top < window.innerHeight)
      return { x: r.right - 10, y: r.top + 10 }
  }
  return { x: entry.x, y: entry.y }
}

/** The composer / answer body shown when an ask's dot is expanded. */
function AskBody({ entry }: { entry: AskEntry }) {
  const submit = useAsks((s) => s.submit)
  const recompose = useAsks((s) => s.recompose)
  const remove = useAsks((s) => s.remove)
  const collapse = useAsks((s) => s.collapse)
  const [text, setText] = useState('')
  const composing = entry.status === 'composing'
  const replied = entry.status === 'done' || entry.status === 'error'

  const ask = () => {
    const q = text.trim()
    if (q) submit(entry.key, q)
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-muted-foreground">Ask</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{entry.ref}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">ephemeral</span>
        {/* once replied: minimize + close together. while composing: close (cancel an
            unsent draft). while STREAMING: neither — nothing to do but wait / click away. */}
        {replied && (
          <button
            type="button"
            title="Minimize"
            onClick={collapse}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        )}
        {(composing || replied) && (
          <button
            type="button"
            title={composing ? 'Cancel' : 'Close'}
            onClick={() => remove(entry.key)}
            className="-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!composing && (
        <div className="space-y-1.5 rounded-md border bg-muted/40 p-2">
          <div className="text-[13px] leading-snug">
            <span className="mr-1.5 text-[10px] font-medium uppercase text-muted-foreground">
              you
            </span>
            {entry.question}
          </div>
          <div className="text-[13px] leading-snug">
            <span className="mr-1.5 text-[10px] font-medium uppercase text-primary">agent</span>
            {entry.status === 'streaming' && !entry.answer ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> thinking…
              </span>
            ) : entry.status === 'error' ? (
              <span className="text-destructive">{entry.error}</span>
            ) : (
              <span className="whitespace-pre-wrap break-words">
                {entry.answer}
                {entry.status === 'streaming' && (
                  <span className="ml-0.5 inline-block h-3 w-[3px] animate-pulse bg-foreground/50 align-middle" />
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {composing ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            className="min-h-16 text-[13px]"
            placeholder={`Ask about ${entry.excerpt}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                ask()
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" onClick={ask} disabled={!text.trim()}>
              <Send className="h-3.5 w-3.5" /> Ask
            </Button>
          </div>
        </div>
      ) : replied ? (
        <div className="flex items-center justify-end">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              recompose(entry.key)
              setText('')
            }}
          >
            Ask another
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** A single ask, shown as a dot on its element; click to expand the popover. */
function AskDot({ entry, pos }: { entry: AskEntry; pos: { x: number; y: number } }) {
  const openKey = useAsks((s) => s.openKey)
  const open = useAsks((s) => s.open)
  const collapse = useAsks((s) => s.collapse)
  const remove = useAsks((s) => s.remove)
  const isOpen = openKey === entry.key

  const tone =
    entry.status === 'streaming'
      ? 'streaming'
      : entry.status === 'error'
        ? 'error'
        : entry.status === 'done' && !entry.seen
          ? 'ready'
          : 'idle'

  return (
    <Popover
      open={isOpen}
      modal={false}
      onOpenChange={(o) => {
        if (o) open(entry.key)
        else if (entry.status === 'composing')
          remove(entry.key) // closing a never-submitted composer cancels it
        else collapse()
      }}
    >
      <PopoverAnchor asChild>
        <button
          type="button"
          title={
            entry.status === 'streaming'
              ? 'Ask — answering…'
              : entry.status === 'done'
                ? 'Ask — answer ready'
                : entry.status === 'error'
                  ? 'Ask — error'
                  : 'Ask'
          }
          onClick={() => (isOpen ? collapse() : open(entry.key))}
          style={{ position: 'fixed', left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }}
          className={cn(
            'z-40 inline-flex h-5 w-5 items-center justify-center rounded-full text-white shadow-md ring-2 ring-card transition-colors',
            tone === 'streaming' && 'bg-primary',
            tone === 'ready' && 'bg-success',
            tone === 'error' && 'bg-destructive',
            tone === 'idle' && 'bg-primary/80 hover:bg-primary',
          )}
        >
          {entry.status === 'streaming' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {tone === 'ready' && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-card" />
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-96">
        <AskBody entry={entry} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Renders every ephemeral ask for the current domain as a dot anchored to its target
 * element (tracked each frame so it follows pan/zoom/scroll). The stream runs in the
 * store, so the answer arrives even while the popover is collapsed — the dot turns
 * green ("answer ready") to bring you back. Mounted once, app-level.
 */
export function AskLayer() {
  const domainId = useUI((s) => s.domainId)
  const entries = useAsks((s) => s.entries)
  const keepOnly = useAsks((s) => s.keepOnly)
  const list = Object.values(entries).filter((e) => e.domainId === domainId)
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({})

  useEffect(() => {
    if (domainId) keepOnly(domainId)
  }, [domainId, keepOnly])

  const keys = list.map((e) => e.key).join('|')
  useEffect(() => {
    if (!keys) {
      setPos({})
      return
    }
    let raf = 0
    const tick = () => {
      const cur = useAsks.getState().entries
      setPos((prev) => {
        const next: Record<string, { x: number; y: number }> = {}
        let changed = false
        for (const k of keys.split('|')) {
          const e = cur[k]
          if (!e) continue
          const p = locate(e)
          next[k] = p
          const pp = prev[k]
          if (!pp || pp.x !== p.x || pp.y !== p.y) changed = true
        }
        if (!changed && Object.keys(prev).length === Object.keys(next).length) return prev
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [keys])

  return (
    <>{list.map((e) => (pos[e.key] ? <AskDot key={e.key} entry={e} pos={pos[e.key]} /> : null))}</>
  )
}
