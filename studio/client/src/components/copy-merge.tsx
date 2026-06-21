import { useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCopy, GitMerge } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useUI } from '@/lib/store'

import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { ScrollArea } from './ui/misc'
import { Textarea } from './ui/textarea'

/** The Copy-to-agent payload dialog (outbound handoff). */
export function CopyDialog() {
  const open = useUI((s) => s.copyOpen)
  const setOpen = useUI((s) => s.setCopyOpen)
  const domainId = useUI((s) => s.domainId)
  const [includeAuto, setIncludeAuto] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || !domainId) return
    setLoading(true)
    api
      .copyPayload(domainId, includeAuto)
      .then((p) => {
        setMarkdown(p.markdown)
        setCount(p.openComments)
      })
      .catch((e) => toast.error(String(e)))
      .finally(() => setLoading(false))
  }, [open, domainId, includeAuto])

  const copy = async () => {
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
    toast.success('Copied — paste into your terminal agent')
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Copy handoff for the agent</DialogTitle>
          <DialogDescription>
            {count} open thread{count === 1 ? '' : 's'} + embedded context and document paths. Paste
            into Claude Code / Codex.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={includeAuto ? 'default' : 'outline'}
            onClick={() => setIncludeAuto((v) => !v)}
          >
            {includeAuto ? 'Including auto-context' : 'Include auto-context'}
          </Button>
          <Badge variant="muted">read-only handoff</Badge>
        </div>
        <ScrollArea className="h-[50vh] rounded-md border bg-muted/40">
          <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
            {loading ? 'Building payload…' : markdown}
          </pre>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={copy} disabled={loading || !markdown}>
            {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy to clipboard'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The paste-back merge dialog (inbound — the agent's reply). */
export function MergeDialog() {
  const open = useUI((s) => s.mergeOpen)
  const setOpen = useUI((s) => s.setMergeOpen)
  const domainId = useUI((s) => s.domainId)
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const merge = async () => {
    if (!domainId || !text.trim()) return
    setBusy(true)
    try {
      const r = await api.mergeReply(domainId, text)
      qc.invalidateQueries({ queryKey: qk.comments(domainId) })
      const bits = [`merged ${r.merged}`, `closed ${r.closed}`]
      if (r.unknownIds.length) bits.push(`${r.unknownIds.length} unknown id(s)`)
      if (r.schemaMismatch) bits.push('⚠ authored against an older schema')
      toast.success(`Reply merged — ${bits.join(', ')}`)
      setText('')
      setOpen(false)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste the agent's reply</DialogTitle>
          <DialogDescription>
            Paste the agent's response (prose + its trailing{' '}
            <code className="font-mono">```json</code> block). Threads merge by id.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          className="min-h-[40vh] text-xs"
          placeholder="Paste the agent reply here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={merge} disabled={busy || !text.trim()}>
            <GitMerge className="h-4 w-4" /> Merge reply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
