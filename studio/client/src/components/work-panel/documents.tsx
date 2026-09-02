import type { DocMeta } from '@shared/types'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  File as FileIcon,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Hash,
  Paperclip,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { FilePickButton } from '@/components/composer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { api, qk } from '@/lib/api'
import { useWorkspace, useWorkspaceDocuments } from '@/lib/hooks'
import { cn } from '@/lib/utils'

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Map a document — or a file not yet uploaded as one — to its icon + short
 *  kind label (PDF, XLS, MD, …). */
export function kindOf(doc: { name: string; type: string }): {
  Icon: typeof FileText
  label: string
} {
  const name = doc.name.toLowerCase()
  const type = doc.type
  if (/\.pdf$/.test(name) || type === 'application/pdf') return { Icon: FileText, label: 'PDF' }
  if (/\.(xlsx?|csv|tsv)$/.test(name) || type.includes('sheet') || type === 'text/csv')
    return { Icon: FileSpreadsheet, label: /\.csv$/.test(name) ? 'CSV' : 'XLS' }
  if (/\.(md|mdx|markdown)$/.test(name) || type === 'text/markdown')
    return { Icon: Hash, label: 'MD' }
  if (/\.(docx?|rtf)$/.test(name) || type.includes('word')) return { Icon: FileType, label: 'DOC' }
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif)$/.test(name))
    return { Icon: FileImage, label: 'IMG' }
  if (/\.(json|ya?ml|toml|ts|tsx|js|jsx|py|go|rs|sh|html|css)$/.test(name) || type.includes('json'))
    return { Icon: FileCode2, label: 'CODE' }
  if (type.startsWith('text/') || /\.(txt|log|env)$/.test(name))
    return { Icon: FileText, label: 'TXT' }
  return { Icon: FileIcon, label: (name.split('.').pop() ?? 'file').slice(0, 4).toUpperCase() }
}

export const isMarkdown = (doc: DocMeta) =>
  doc.type === 'text/markdown' || /\.(md|mdx|markdown)$/i.test(doc.name)

/**
 * The composer's paperclip. With one domain it picks files directly; with several it
 * first asks for the explicit owner, because a workspace has no implicit active domain.
 *
 * What has already been given to the agent is not behind it — that is what
 * `DocumentChips` shows, in the composer, where you can see it without asking.
 */
export function AttachButton({
  onPicked,
}: {
  /** Give the caret back to the composer — a page with nothing focused reads plain
   *  letters as the global hotkeys, so typing after attaching would toggle Ask mode. */
  onPicked?: () => void
}) {
  const { data: domains = [] } = useWorkspace()
  const [open, setOpen] = useState(false)
  if (domains.length === 1)
    return <DomainAttachButton domainId={domains[0]!.id} onPicked={onPicked} />

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={domains.length === 0}
          title="Attach a document to a domain"
          aria-label="Attach a document to a domain"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <Paperclip className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-1.5">
        <p className="px-2 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Attach to domain
        </p>
        {domains.map((domain) => (
          <div
            key={domain.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
          >
            <span className="min-w-0 flex-1 truncate text-[12px]">{domain.origin}</span>
            <DomainAttachButton
              domainId={domain.id}
              onPicked={() => {
                setOpen(false)
                onPicked?.()
              }}
            />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function DomainAttachButton({ domainId, onPicked }: { domainId: string; onPicked?: () => void }) {
  const { upload } = useDocumentMutations(domainId)
  return (
    <FilePickButton
      busy={upload.isPending}
      label={`Attach a document to ${domainId}`}
      onFiles={(files) => upload.mutate(files)}
      onPicked={onPicked}
    />
  )
}

/**
 * What the agent can read, said in the composer rather than hidden in a menu.
 *
 * There is nothing to insert into a message — every document is listed in the
 * prompt with its path on every turn, so the agent already knows they exist and
 * opens the ones it needs. These are here to be seen, and to be taken back.
 *
 * Chips only, no row of their own: they share one with the open threads, which the
 * next turn carries just the same.
 */
export function DocumentChips() {
  const { data: groups } = useWorkspaceDocuments()
  const [editing, setEditing] = useState<{ domainId: string; doc: DocMeta } | null>(null)

  return (
    <>
      {groups.map((group) => (
        <DomainDocumentChips
          key={group.domain.id}
          domainId={group.domain.id}
          domainLabel={group.domain.origin}
          docs={group.documents ?? []}
          onEdit={(doc) => setEditing({ domainId: group.domain.id, doc })}
        />
      ))}
      {editing && (
        <EditDialog
          domainId={editing.domainId}
          doc={editing.doc}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function DomainDocumentChips({
  domainId,
  domainLabel,
  docs,
  onEdit,
}: {
  domainId: string
  domainLabel: string
  docs: DocMeta[]
  onEdit: (doc: DocMeta) => void
}) {
  const { remove } = useDocumentMutations(domainId)

  return (
    <>
      {docs.map((doc) => {
        const kind = kindOf(doc)
        // markdown is the only kind the studio can edit, so for those the chip opens
        // the editor; anything else it can only hand to the browser
        const editable = isMarkdown(doc)
        const face = (
          <>
            <kind.Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {domainLabel} · {doc.name}
            </span>
          </>
        )
        return (
          <span key={doc.id} className={cn(CHIP, 'border-border bg-muted/60')}>
            {editable ? (
              <button
                type="button"
                onClick={() => onEdit(doc)}
                title={`Edit ${doc.name} in ${domainLabel}`}
                className="flex min-w-0 items-center gap-1.5 pr-1"
              >
                {face}
              </button>
            ) : (
              <a
                href={api.docUrl(domainId, doc.id)}
                target="_blank"
                rel="noreferrer"
                title={`${doc.name} in ${domainLabel} — ${fmtSize(doc.size)}`}
                className="flex min-w-0 items-center gap-1.5 pr-1"
              >
                {face}
              </a>
            )}
            <button
              type="button"
              onClick={() => remove.mutate(doc.id)}
              title={`Remove ${doc.name}`}
              aria-label={`Remove ${doc.name}`}
              className="mr-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )
      })}
    </>
  )
}

/** The shape every chip on the composer wears, whatever it carries. */
export const CHIP = 'group flex h-6 max-w-[220px] items-center rounded-full border pl-2 text-[11px]'

/** Upload / remove, shared by the paperclip, the chips and the drop target. */
export function useDocumentMutations(domainId: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.documents(domainId) })
  const upload = useMutation({
    mutationFn: (files: File[]) => api.uploadDocuments(domainId, files),
    onSuccess: invalidate,
    onError: (error) => toast.error(String(error)),
  })
  // Removing a document is predictable, so drop it from the list immediately and
  // put it back (with a toast) if the server disagrees.
  const remove = useMutation({
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
  return { upload, remove }
}

function EditDialog({
  domainId,
  doc,
  onClose,
}: {
  domainId: string
  doc: DocMeta
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [content, setContent] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    setLoadFailed(false)
    setContent(null) // reset (disables the textarea) so a doc switch can never show/clobber stale content
    api
      .docContent(domainId, doc.id)
      .then((text) => alive && setContent(text))
      .catch(() => {
        if (alive) {
          toast.error('Could not load document')
          setLoadFailed(true)
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
      qc.invalidateQueries({ queryKey: qk.documents(domainId) })
      onClose()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate text-sm">{doc.name}</DialogTitle>
        </DialogHeader>
        <Textarea
          // biome-ignore lint/a11y/noAutofocus: jump straight to editing
          autoFocus
          value={content ?? ''}
          disabled={content == null}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              save()
            }
          }}
          placeholder={
            loadFailed ? 'Could not load this document. Close and try again.' : 'Loading…'
          }
          className="min-h-[50vh] resize-none font-mono text-[12px] leading-relaxed"
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || content == null || loadFailed}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
