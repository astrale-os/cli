import type { AgentRun, DocMeta } from '@shared/types'
import type { DragEvent, ReactNode } from 'react'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Copy,
  CornerDownLeft,
  File as FileIcon,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Hash,
  Loader2,
  Maximize2,
  Minimize2,
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

/** Map a document to a typed icon + colour tile + short label (PDF, XLS, MD, …). */
function kindOf(doc: DocMeta): { Icon: typeof FileText; tint: string; label: string } {
  const n = doc.name.toLowerCase()
  const t = doc.type
  if (/\.pdf$/.test(n) || t === 'application/pdf')
    return { Icon: FileText, tint: 'bg-red-400/10 text-red-400', label: 'PDF' }
  if (/\.(xlsx?|csv|tsv)$/.test(n) || t.includes('sheet') || t === 'text/csv')
    return {
      Icon: FileSpreadsheet,
      tint: 'bg-emerald-400/10 text-emerald-400',
      label: /\.csv$/.test(n) ? 'CSV' : 'XLS',
    }
  if (/\.(md|mdx|markdown)$/.test(n) || t === 'text/markdown')
    return { Icon: Hash, tint: 'bg-sky-400/10 text-sky-400', label: 'MD' }
  if (/\.(docx?|rtf)$/.test(n) || t.includes('word'))
    return { Icon: FileType, tint: 'bg-blue-400/10 text-blue-400', label: 'DOC' }
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif)$/.test(n))
    return { Icon: FileImage, tint: 'bg-fuchsia-400/10 text-fuchsia-400', label: 'IMG' }
  if (/\.(json|ya?ml|toml|ts|tsx|js|jsx|py|go|rs|sh|html|css)$/.test(n) || t.includes('json'))
    return { Icon: FileCode2, tint: 'bg-amber-400/10 text-amber-400', label: 'CODE' }
  if (t.startsWith('text/') || /\.(txt|log|env)$/.test(n))
    return { Icon: FileText, tint: 'bg-slate-400/10 text-slate-400', label: 'TXT' }
  return {
    Icon: FileIcon,
    tint: 'bg-muted text-muted-foreground',
    label: (n.split('.').pop() ?? 'file').slice(0, 4).toUpperCase(),
  }
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
export function ContextSection({ domainId }: { domainId: string }) {
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
  const del = useMutation({
    mutationFn: (docId: string) => api.deleteDocument(domainId, docId),
    onSuccess: invalidate,
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
        <div className="mx-auto w-full max-w-3xl space-y-6 px-6 pb-28 pt-10">
          <AgentComposer domainId={domainId} />
          {count === 0 ? (
            <div className="space-y-4">
              <Composer busy={upload.isPending} onText={addText} onFiles={addFiles} />
              <DropZone busy={upload.isPending} onFiles={addFiles} />
            </div>
          ) : (
            <div className="space-y-6">
              <Composer busy={upload.isPending} onText={addText} onFiles={addFiles} />
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {docs.map((doc) => (
                  <DocCard
                    key={doc.id}
                    domainId={domainId}
                    doc={doc}
                    onEdit={() => setEditDoc(doc)}
                    onDelete={() => del.mutate(doc.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 px-16 py-12 text-primary">
            <Upload className="h-8 w-8" />
            <p className="text-sm font-medium">Drop to add</p>
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

function ExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const Icon = expanded ? Minimize2 : Maximize2
  const label = expanded ? 'Collapse editor' : 'Expand editor'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-3.5 w-3.5" />
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
    <div className="rounded-2xl border bg-card/50 shadow-sm transition-colors focus-within:border-primary/50">
      <div className="relative">
        <Textarea
          // biome-ignore lint/a11y/noAutofocus: the agent prompt is the primary action of this page
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Tell me what you want to do?"
          className={cn(
            'max-h-[65vh] min-h-[120px] resize-y border-0 bg-transparent pr-10 text-[15px] leading-relaxed shadow-none focus-visible:ring-0',
            expanded && 'min-h-[45vh]',
          )}
        />
        <ExpandButton expanded={expanded} onClick={() => setExpanded((v) => !v)} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-[11px] text-muted-foreground/50">
          {active ? 'Agent working…' : available ? '⌘↵ to send' : 'agent unavailable'}
        </span>
        <Button size="sm" onClick={submit} disabled={!canSend}>
          {busy || active ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}{' '}
          Send to agent
        </Button>
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
  const [expanded, setExpanded] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const submit = () => {
    const t = text.trim()
    if (!t || busy) return
    onText(text)
    setText('')
  }
  return (
    <div className="rounded-2xl border bg-card/50 shadow-sm transition-colors focus-within:border-primary/50">
      <div className="relative">
        <Textarea
          // biome-ignore lint/a11y/noAutofocus: the composer is the primary action of this page
          autoFocus={hero}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={
            hero ? 'Paste anything — notes, specs, decisions…' : 'Paste text to save as markdown…'
          }
          className={cn(
            'max-h-[65vh] resize-y border-0 bg-transparent pr-10 leading-relaxed shadow-none focus-visible:ring-0',
            expanded
              ? hero
                ? 'min-h-[45vh] text-[15px]'
                : 'min-h-[32vh]'
              : hero
                ? 'min-h-[180px] text-[15px]'
                : 'min-h-[80px]',
          )}
        />
        <ExpandButton expanded={expanded} onClick={() => setExpanded((v) => !v)} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        {hero ? (
          <span className="text-[11px] text-muted-foreground/50">⌘↵ to save</span>
        ) : (
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
        {text.trim() && (
          <Button size="sm" onClick={submit} disabled={busy}>
            <CornerDownLeft className="h-3.5 w-3.5" /> Save
          </Button>
        )}
      </div>
    </div>
  )
}

// ── empty-state drop zone ───────────────────────────────────────────────────────
function DropZone({
  busy,
  onFiles,
}: {
  busy: boolean
  onFiles: (f: FileList | File[] | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-10 text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:bg-accent/20"
    >
      <Upload className="h-6 w-6" />
      <p className="text-[13px]">{busy ? 'Uploading…' : 'Drop files or browse'}</p>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </button>
  )
}

// ── document card ───────────────────────────────────────────────────────────────
function DocCard({
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
    <div className="group flex flex-col gap-2.5 rounded-xl border bg-card/50 p-3 transition-colors hover:border-muted-foreground/30 hover:bg-accent/30">
      <div className="flex items-start justify-between">
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', k.tint)}>
          <k.Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
      <a href={api.docUrl(domainId, doc.id)} target="_blank" rel="noreferrer" className="min-w-0">
        <div className="truncate text-[13px] font-medium leading-snug" title={doc.name}>
          {doc.name}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {k.label} · {fmtSize(doc.size)}
        </div>
      </a>
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
        'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors',
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
          <span className="mr-auto text-[11px] text-muted-foreground/60">⌘↵ to save</span>
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
