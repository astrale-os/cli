import type { AgentRun, DocMeta } from '@shared/types'
import type { DragEvent, ReactNode } from 'react'

import { DOCUMENTS_DIR } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUp,
  Copy,
  File as FileIcon,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Hash,
  Loader2,
  Pencil,
  Send,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { isRunActive, useAgentLive, useAgentSnapshot, useDisplayRun } from '@/lib/agent'
import { api, qk } from '@/lib/api'
import { useDocuments } from '@/lib/hooks'
import { cn } from '@/lib/utils'

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Map a document to its icon + short kind label (PDF, XLS, MD, …). */
function kindOf(doc: DocMeta): { Icon: typeof FileText; label: string } {
  const n = doc.name.toLowerCase()
  const t = doc.type
  if (/\.pdf$/.test(n) || t === 'application/pdf') return { Icon: FileText, label: 'PDF' }
  if (/\.(xlsx?|csv|tsv)$/.test(n) || t.includes('sheet') || t === 'text/csv')
    return { Icon: FileSpreadsheet, label: /\.csv$/.test(n) ? 'CSV' : 'XLS' }
  if (/\.(md|mdx|markdown)$/.test(n) || t === 'text/markdown') return { Icon: Hash, label: 'MD' }
  if (/\.(docx?|rtf)$/.test(n) || t.includes('word')) return { Icon: FileType, label: 'DOC' }
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif)$/.test(n))
    return { Icon: FileImage, label: 'IMG' }
  if (/\.(json|ya?ml|toml|ts|tsx|js|jsx|py|go|rs|sh|html|css)$/.test(n) || t.includes('json'))
    return { Icon: FileCode2, label: 'CODE' }
  if (t.startsWith('text/') || /\.(txt|log|env)$/.test(n)) return { Icon: FileText, label: 'TXT' }
  return { Icon: FileIcon, label: (n.split('.').pop() ?? 'file').slice(0, 4).toUpperCase() }
}
const isMarkdown = (d: DocMeta) =>
  d.type === 'text/markdown' || /\.(md|mdx|markdown)$/i.test(d.name)
const isText = (d: DocMeta) =>
  d.type.startsWith('text/') ||
  d.type.includes('json') ||
  isMarkdown(d) ||
  /\.(txt|json|ya?ml|csv|tsv|ts|tsx|js|jsx|html|css|toml|env|log)$/i.test(d.name)
function slugifyToMd(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'note'}.md`
}
/** Name a pasted note from its first heading/line. */
const nameFromText = (text: string) =>
  slugifyToMd(
    (
      text
        .split('\n')
        .map((l) => l.replace(/^#+\s*/, '').trim())
        .find(Boolean) ?? ''
    ).slice(0, 60),
  )

// ── page ──────────────────────────────────────────────────────────────────────
/**
 * The agent half of the work panel: say what you want, drop the documents the
 * agent should read. It lives beside whatever view you are in, so instructing the
 * agent never costs you the schema you were looking at.
 */
export function AgentTab({ domainId }: { domainId: string }) {
  const { data: docs } = useDocuments(domainId)
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.documents(domainId) })
  const [dragging, setDragging] = useState(false)
  const [editDoc, setEditDoc] = useState<DocMeta | null>(null)

  const upload = useMutation({
    mutationFn: (files: File[]) => api.uploadDocuments(domainId, files),
    onSuccess: (added) => {
      invalidate()
      toast.success(`Added ${added.length} document${added.length === 1 ? '' : 's'}`)
    },
    onError: (e) => toast.error(String(e)),
  })
  // Removing a document is predictable, so drop it from the list immediately and
  // put it back (with a toast) if the server disagrees.
  const del = useMutation({
    mutationFn: (docId: string) => api.deleteDocument(domainId, docId),
    onMutate: async (docId: string) => {
      await qc.cancelQueries({ queryKey: qk.documents(domainId) })
      const previous = qc.getQueryData<DocMeta[]>(qk.documents(domainId))
      qc.setQueryData<DocMeta[]>(
        qk.documents(domainId),
        (current) => current?.filter((doc) => doc.id !== docId) ?? current,
      )
      return { previous }
    },
    onError: (error, _docId, context) => {
      if (context?.previous) qc.setQueryData(qk.documents(domainId), context.previous)
      toast.error(`Could not remove the document — ${String((error as Error)?.message ?? error)}`)
    },
    onSettled: invalidate,
  })

  const addFiles = (files: FileList | File[] | null) => {
    const arr = files ? [...files] : []
    if (arr.length) upload.mutate(arr)
  }
  const addText = (text: string, title?: string) =>
    upload.mutate([
      new File([text], title ? slugifyToMd(title) : nameFromText(text), { type: 'text/markdown' }),
    ])

  const onDrop = (e: DragEvent) => {
    const files = e.dataTransfer.files
    if (files?.length) {
      e.preventDefault()
      setDragging(false)
      addFiles(files)
      return
    }
    setDragging(false)
    if ((e.target as HTMLElement).closest('textarea, input')) return // let a field handle its own text drop
    const text = e.dataTransfer.getData('text/plain')
    if (text.trim()) {
      e.preventDefault()
      addText(text)
    }
  }

  if (!docs)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  const count = docs.length

  return (
    <div
      className="relative h-full"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="h-full overflow-y-auto">
        <div className="w-full space-y-5 px-3 py-3">
          <AgentComposer domainId={domainId} />
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Documents
              </h2>
              <span
                title={`Saved in ${DOCUMENTS_DIR}/ — the agent reads them from there`}
                className="truncate font-mono text-[10px] text-muted-foreground"
              >
                {DOCUMENTS_DIR}
              </span>
            </div>
            <Composer busy={upload.isPending} onText={addText} onFiles={addFiles} />
            {count > 0 && (
              <div className="divide-y overflow-hidden rounded-lg border bg-card">
                {docs.map((doc) => (
                  <DocRow
                    key={doc.id}
                    domainId={domainId}
                    doc={doc}
                    onEdit={() => setEditDoc(doc)}
                    onDelete={() => del.mutate(doc.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/75">
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/50 bg-card px-5 py-3 text-sm font-medium text-primary">
            <Upload className="h-4 w-4" /> Drop to add
          </div>
        </div>
      )}

      {editDoc && (
        <EditDialog
          domainId={domainId}
          doc={editDoc}
          onClose={() => setEditDoc(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}

/** A prompt field that grows with its content — no scrollbar, no resize grip. */
function GrowingField({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
  minRows = 3,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  placeholder: string
  autoFocus?: boolean
  minRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      // biome-ignore lint/a11y/noAutofocus: the composer is the primary action of this page
      autoFocus={autoFocus}
      rows={minRows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onSubmit()
        }
      }}
      placeholder={placeholder}
      className="w-full resize-none bg-transparent px-3.5 pt-3 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
    />
  )
}

/** The one send affordance: a round button that turns into a spinner while working. */
function SendButton({
  onClick,
  disabled,
  busy,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  )
}

// ── agent composer: free-text instruction → the AI agent ───────────────────────
function AgentComposer({ domainId }: { domainId: string }) {
  const [text, setText] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const snap = useAgentSnapshot(domainId)
  const run = useDisplayRun(domainId)
  const setRun = useAgentLive((s) => s.setRun)
  const qc = useQueryClient()
  const active = isRunActive(run)
  const available = snap.data?.available ?? false
  const canSend = text.trim().length > 0 && !busy && !active && available

  const submit = async () => {
    if (!canSend) return
    setBusy(true)
    try {
      const r = await api.agentSubmit(domainId, text.trim())
      if ((r as { error?: string }).error) {
        toast.error((r as { error?: string }).error as string)
        return
      }
      setRun(r as AgentRun)
      setText('')
      toast.success('Sent to the agent')
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
      qc.invalidateQueries({ queryKey: qk.agent(domainId) })
    }
  }

  return (
    <div className="rounded-xl border bg-card transition-colors focus-within:border-ring">
      <GrowingField
        autoFocus
        value={text}
        onChange={setText}
        onSubmit={submit}
        placeholder="Ask the agent to change this domain…"
      />
      <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 pt-1">
        {active && <span className="mr-auto text-xs text-muted-foreground">Agent working…</span>}
        {!available && (
          <span className="mr-auto text-xs text-muted-foreground">Agent unavailable</span>
        )}
        <SendButton
          onClick={submit}
          disabled={!canSend}
          busy={busy || active}
          title="Send to the agent (⌘↵)"
        >
          <ArrowUp className="h-4 w-4" />
        </SendButton>
      </div>
    </div>
  )
}

// ── composer: paste text → markdown ────────────────────────────────────────────
function Composer({
  hero,
  busy,
  onText,
  onFiles,
}: {
  hero?: boolean
  busy: boolean
  onText: (t: string) => void
  onFiles: (f: FileList | File[] | null) => void
}) {
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const submit = () => {
    const t = text.trim()
    if (!t || busy) return
    onText(text)
    setText('')
  }
  return (
    <div className="rounded-xl border bg-card transition-colors focus-within:border-ring">
      <GrowingField
        autoFocus={hero}
        minRows={2}
        value={text}
        onChange={setText}
        onSubmit={submit}
        placeholder={hero ? 'Paste anything — notes, specs, decisions…' : 'Paste a note…'}
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
        {!hero && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload'}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                onFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </>
        )}
        <div className="ml-auto">
          <SendButton
            onClick={submit}
            disabled={!text.trim() || busy}
            busy={busy && !!text.trim()}
            title="Save as a document (⌘↵)"
          >
            <ArrowUp className="h-4 w-4" />
          </SendButton>
        </div>
      </div>
    </div>
  )
}

// ── document row ────────────────────────────────────────────────────────────────
function DocRow({
  domainId,
  doc,
  onEdit,
  onDelete,
}: {
  domainId: string
  doc: DocMeta
  onEdit: () => void
  onDelete: () => void
}) {
  const k = kindOf(doc)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await api.docContent(domainId, doc.id))
      toast.success('Copied')
    } catch {
      toast.error('Copy failed')
    }
  }
  return (
    <div className="group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/60">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <k.Icon className="h-4 w-4" />
      </div>
      <a
        href={api.docUrl(domainId, doc.id)}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1"
      >
        <div className="truncate text-[13px] font-medium" title={doc.name}>
          {doc.name}
        </div>
        <div className="text-xs text-muted-foreground">
          {k.label} · {fmtSize(doc.size)}
        </div>
      </a>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {isText(doc) && (
          <IconBtn title="Copy" onClick={copy}>
            <Copy className="h-3.5 w-3.5" />
          </IconBtn>
        )}
        {isMarkdown(doc) && (
          <IconBtn title="Edit" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </IconBtn>
        )}
        <IconBtn title="Remove" danger onClick={onDelete}>
          <X className="h-3.5 w-3.5" />
        </IconBtn>
      </div>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
        danger
          ? 'hover:bg-destructive/10 hover:text-destructive'
          : 'hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

// ── markdown editor ─────────────────────────────────────────────────────────────
function EditDialog({
  domainId,
  doc,
  onClose,
  onSaved,
}: {
  domainId: string
  doc: DocMeta
  onClose: () => void
  onSaved: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    setContent(null) // reset (disables the textarea) so a doc switch can never show/clobber stale content
    api
      .docContent(domainId, doc.id)
      .then((c) => alive && setContent(c))
      .catch(() => {
        if (alive) {
          toast.error('Could not load document')
          setContent('')
        }
      })
    return () => {
      alive = false
    }
  }, [domainId, doc.id])
  const save = async () => {
    if (content == null) return
    setBusy(true)
    try {
      await api.updateDocument(domainId, doc.id, content)
      toast.success('Saved')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate text-sm">{doc.name}</DialogTitle>
        </DialogHeader>
        <Textarea
          // biome-ignore lint/a11y/noAutofocus: jump straight to editing
          autoFocus
          value={content ?? ''}
          disabled={content == null}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
          placeholder={content == null ? 'Loading…' : ''}
          className="min-h-[50vh] resize-none font-mono text-[12px] leading-relaxed"
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || content == null}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
