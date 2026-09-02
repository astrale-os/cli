/**
 * composer.tsx — the parts a message composer is made of.
 *
 * Two of them share these: the agent composer, which writes into a domain, and
 * the one that opens a NEW domain, which writes the first message of a domain
 * that does not exist yet. They have to read as the same object — you are
 * talking to the same agent, one moment earlier — so the field, the clip, the
 * send button and the drop target are defined once here, and the two callers
 * differ only in what they do with what comes out.
 */
import type { DragEvent, ReactNode } from 'react'

import { ArrowUp, Loader2, Paperclip, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/** The card a composer sits in: one border, lit while you are writing in it. */
export function ComposerFrame({
  className,
  children,
  ...rest
}: { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        'rounded-xl border bg-card transition-colors focus-within:border-ring',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * The field itself: it grows with what is written in it, up to a fraction of the
 * window, and Enter sends — Shift+Enter is how you get a line instead.
 */
export function ComposerField({
  value,
  onChange,
  onSubmit,
  className,
  ref,
  ...rest
}: {
  value: string
  onChange: (next: string) => void
  /** Enter without Shift — the one gesture a composer has. */
  onSubmit: () => void
  /** The caller's own handle on the field: the dock focuses it, the clip gives
   *  the caret back to it. Left out, the field still grows on its own. */
  ref?: React.RefObject<HTMLTextAreaElement | null>
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'ref'>) {
  const own = useRef<HTMLTextAreaElement>(null)
  const field = ref ?? own

  useEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [value, field])

  return (
    <textarea
      {...rest}
      ref={field}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        // an IME composition also ends on Enter, and that Enter is not a send
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          onSubmit()
        }
      }}
      className={cn(
        'resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground',
        className,
      )}
    />
  )
}

/** The round button that ends the row. What it shows is what pressing it does. */
export function SendButton({
  onClick,
  disabled,
  title,
  label,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  label: string
  /** shown instead of the arrow — the queue's icon, a spinner while it works */
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90',
        'disabled:bg-muted disabled:text-muted-foreground',
      )}
    >
      {children ?? <ArrowUp className="h-4 w-4" />}
    </button>
  )
}

/**
 * The paperclip. One click, one meaning: pick files. What becomes of them is the
 * caller's business — a domain uploads them, a domain that does not exist yet
 * holds on to them until it does.
 */
export function FilePickButton({
  onFiles,
  onPicked,
  busy,
  disabled,
  label = 'Attach a document',
  busyLabel = 'Uploading…',
}: {
  onFiles: (files: File[]) => void
  /** Give the caret back to the composer — a page with nothing focused reads plain
   *  letters as the global hotkeys, so typing after attaching would toggle Ask mode. */
  onPicked?: () => void
  /** This button is the thing working: it spins. */
  busy?: boolean
  /** Something ELSE is working: it waits, quietly. One spinner per thing. */
  disabled?: boolean
  label?: string
  busyLabel?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const title = busy ? busyLabel : label

  return (
    <>
      <button
        type="button"
        title={title}
        aria-label={title}
        disabled={busy || disabled}
        onClick={() => input.current?.click()}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files ? [...event.target.files] : []
          event.target.value = ''
          if (files.length) onFiles(files)
          onPicked?.()
        }}
      />
    </>
  )
}

/**
 * Whatever it wraps takes files by drag and drop, and says so while one is over
 * it. The overlay is absolute, so the wrapper must position it — every caller
 * passes `relative` in its own className.
 */
export function DropZone({
  onFiles,
  className,
  ref,
  children,
  ...rest
}: {
  onFiles: (files: File[]) => void
  className?: string
  ref?: React.Ref<HTMLDivElement>
  children: ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      {...rest}
      ref={ref}
      className={className}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event: DragEvent) => {
        setDragging(false)
        const files = [...(event.dataTransfer.files ?? [])]
        if (!files.length) return
        event.preventDefault()
        onFiles(files)
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/75">
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/50 bg-card px-5 py-3 text-sm font-medium text-primary">
            <Upload className="h-4 w-4" /> Drop to add
          </div>
        </div>
      )}
    </div>
  )
}
