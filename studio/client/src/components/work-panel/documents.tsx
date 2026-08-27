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
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { api, qk } from '@/lib/api'
import { useDocuments } from '@/lib/hooks'
import { cn } from '@/lib/utils'

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Map a document to its icon + short kind label (PDF, XLS, MD, …). */
export function kindOf(doc: DocMeta): { Icon: typeof FileText; label: string } {
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
 * The composer's paperclip: what the agent has been given to read.
 *
 * There is nothing to insert into a message — every document is listed in the
 * prompt with its path on every turn, so the agent already knows they exist and
 * opens the ones it needs.
 */
export function DocumentsMenu({ domainId }: { domainId: string }) {
  const { data: docs } = useDocuments(domainId)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<DocMeta | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { upload, remove } = useDocumentMutations(domainId)

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Documents"
            aria-label="Documents"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-72 p-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-accent"
          >
            <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            {upload.isPending ? 'Uploading…' : 'Upload a document'}
          </button>
          {docs && docs.length > 0 && (
            <>
              <div className="mt-1 border-t pt-1 text-[11px] text-muted-foreground">
                <span className="px-2">The agent can read these</span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {docs.map((doc) => {
                  const kind = kindOf(doc)
                  return (
                    <div key={doc.id} className="group flex items-center gap-1">
                      <a
                        href={api.docUrl(domainId, doc.id)}
                        target="_blank"
                        rel="noreferrer"
                        title={`.domain-studio/${doc.stored}`}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                      >
                        <kind.Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[13px]">{doc.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {fmtSize(doc.size)}
                        </span>
                      </a>
                      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {isMarkdown(doc) && (
                          <IconBtn
                            title="Edit"
                            onClick={() => {
                              setEditing(doc)
                              setOpen(false)
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </IconBtn>
                        )}
                        <IconBtn title="Remove" danger onClick={() => remove.mutate(doc.id)}>
                          <Trash2 className="h-3 w-3" />
                        </IconBtn>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files ? [...event.target.files] : []
          event.target.value = ''
          setOpen(false)
          if (files.length) upload.mutate(files)
        }}
      />
      {editing && <EditDialog domainId={domainId} doc={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/** Upload / remove, shared by the menu and the drop target. */
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

function IconBtn({
  title,
  onClick,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors',
        danger
          ? 'hover:bg-destructive/10 hover:text-destructive'
          : 'hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
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
