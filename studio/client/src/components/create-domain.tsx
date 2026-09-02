/**
 * create-domain.tsx — how a domain begins.
 *
 * It begins as a conversation. The rail's plus opens one composer in the middle
 * of the screen: a name written like a title, and under it the same field, the
 * same clip and the same send button the agent has everywhere else in the
 * studio — because that is what this is. Pressing send scaffolds the domain
 * under the name that was typed and hands the message straight to the agent
 * working in it, so the first turn of a new domain is a first turn like any
 * other, and the studio lands on it already running.
 *
 * What is NOT here is as deliberate: no comment chips (a domain that does not
 * exist has no threads), no model picker (a chat has to exist to have one — the
 * new domain opens on the preferred model, and the picker is one click away in
 * the dock once it does). Files are the exception: they can be staged before
 * the domain exists, and are uploaded to it the moment it does.
 */
import type { AgentRun } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { useAgentLive } from '@/lib/agent'
import { api, qk } from '@/lib/api'
import { createDomainWithBrief, type NewDomainPhase, readName } from '@/lib/new-domain'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useCanvasDomains } from '@/schema-studio/workspace/canvas-selection'

import { ComposerField, ComposerFrame, DropZone, FilePickButton, SendButton } from './composer'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { CHIP, fmtSize, kindOf } from './work-panel/documents'

const PROMPT = 'Describe the domain — what it models, what it is for…'

/** The centred composer, opened from the rail's plus (and from an empty workspace). */
export function NewDomainDialog() {
  const open = useUI((state) => state.newDomainOpen)
  const setOpen = useUI((state) => state.setNewDomainOpen)
  // A send in flight is scaffolding a folder and installing into it. Escape, the
  // backdrop and the close button all come through here, and none of them may
  // take away the only window that will say how it went.
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && setOpen(false)}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        data-studio-rise=""
        // The studio steps well back for this one: the composer is the only thing
        // to read, and a canvas showing through it competes with every line of it.
        overlayClassName="bg-background/85 backdrop-blur-[3px]"
        className="w-full max-w-3xl border-0 bg-transparent p-0 shadow-none focus:outline-none"
      >
        <DialogTitle className="sr-only">New domain</DialogTitle>
        {/* mounted only while open, so every field starts empty each time */}
        {open && <NewDomainCard onBusy={setBusy} onClose={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The card itself. It owns everything that is typed into it and, on send, the
 * whole order — create, attach, brief — reporting where it has got to as it
 * goes, because none of the three steps is instant.
 */
export function NewDomainCard({
  onClose,
  onBusy,
}: {
  onClose: () => void
  /** the send cannot be interrupted — tell whoever can close this that it is running */
  onBusy?: (busy: boolean) => void
}) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<NewDomainPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)

  const queryClient = useQueryClient()
  const setRun = useAgentLive((state) => state.setRun)
  const setSection = useUI((state) => state.setSection)
  const setPanelTab = useUI((state) => state.setPanelTab)
  const setAgentDraft = useUI((state) => state.setAgentDraft)
  const canvas = useCanvasDomains()

  const reading = readName(name)
  const busy = phase !== 'idle'
  // A name alone makes a folder, not a domain: what the agent is being asked for
  // is the other half of the request, and there is no turn to start without it.
  const canSend = reading.valid && !!message.trim() && !busy

  const stage = (picked: File[]) => setFiles((current) => [...current, ...picked])
  const enter = (next: NewDomainPhase) => {
    setPhase(next)
    onBusy?.(next !== 'idle')
  }

  /** Open the new domain on the conversation the first message started. */
  const land = (id: string, run?: AgentRun) => {
    if (run) setRun(run)
    void queryClient.invalidateQueries({ queryKey: qk.chats })
    void queryClient.invalidateQueries({ queryKey: qk.agent() })
    if (!canvas.visible.has(id)) canvas.toggleOnCanvas(id)
    setSection('schema')
    // the turn is already running — open on it rather than on a canvas that is
    // still being drawn, which is what makes this read as one gesture
    setPanelTab('agent')
  }

  const send = async () => {
    if (!canSend) return
    setError(null)
    const outcome = await createDomainWithBrief(
      {
        createDomain: api.createDomain,
        uploadDocuments: api.uploadDocuments,
        submit: async (_id, text) => {
          const chat = await api.openChat()
          return api.agentSubmit(text, chat.id)
        },
        onPhase: enter,
      },
      { name, message, files },
    )
    enter('idle')

    // Nothing was created: everything typed is still here, and so is the reason.
    if (!outcome.id) {
      setError(outcome.error ?? 'Could not create the domain — check the studio logs.')
      return
    }

    // From here the domain is real, so the studio goes there whatever else
    // happened — a domain that exists and is not shown is the worst of both.
    await queryClient.invalidateQueries({ queryKey: qk.workspace })
    land(outcome.id, outcome.run)
    if (outcome.error) {
      // the message never left; put it where pressing Enter sends it again
      if (outcome.unsent) setAgentDraft(outcome.unsent)
      toast.error(
        `${outcome.origin ?? reading.slug} was created, but the agent did not start — ${outcome.error}`,
      )
    } else {
      toast.success(`Created ${outcome.origin ?? reading.slug}`)
    }
    onClose()
  }

  return (
    <div data-testid="new-domain" className="flex w-full flex-col items-center gap-4">
      {/* The name, written like the title of the thing being made — and the only
          thing said about it is what is wrong with it. */}
      <div className="flex w-full flex-col items-center gap-1">
        <input
          // biome-ignore lint/a11y/noAutofocus: the name is the first thing to write
          autoFocus
          value={name}
          disabled={busy}
          placeholder="domain name"
          aria-label="Domain name"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            // Enter on the name is not a send — it is "now tell it what to do"
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (reading.valid) field.current?.focus()
          }}
          className={cn(
            'w-full bg-transparent text-center font-mono text-[26px] font-semibold tracking-tight outline-none placeholder:text-muted-foreground/40 disabled:opacity-60',
            // A centred empty field puts the caret in the MIDDLE of the prompt it
            // is showing — a bar through the word. Nothing typed, nothing to
            // point at: the caret arrives with the first letter.
            !name && 'caret-transparent',
          )}
        />
        <p className="h-4 text-[11.5px] text-destructive">{reading.error}</p>
      </div>

      {/* The composer, exactly as it is in the dock — the domain it will talk to
          is the only thing missing, and sending is what makes it. */}
      <DropZone onFiles={stage} className="relative w-full">
        <ComposerFrame className="shadow-[0_20px_60px_-28px_rgb(0_0_0/0.55)]">
          {files.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 pt-2">
              {files.map((file, index) => (
                <StagedChip
                  key={`${file.name}:${file.size}:${index}`}
                  file={file}
                  disabled={busy}
                  onRemove={() =>
                    setFiles((current) => current.filter((_, other) => other !== index))
                  }
                />
              ))}
            </div>
          )}
          <ComposerField
            ref={field}
            data-new-domain-composer=""
            value={message}
            onChange={setMessage}
            onSubmit={send}
            placeholder={PROMPT}
            disabled={busy}
            className="w-full px-3 pt-2.5"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            {/* the send is what is working, and it is already saying so */}
            <FilePickButton
              disabled={busy}
              onFiles={stage}
              onPicked={() => field.current?.focus()}
            />
            <div className="ml-auto flex items-center gap-1.5">
              <SendButton
                onClick={send}
                disabled={!canSend}
                title={
                  reading.valid && !message.trim()
                    ? 'Tell the agent what to build first'
                    : 'Create the domain, then send this to its agent (↵)'
                }
                label="Create the domain"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
              </SendButton>
            </div>
          </div>
        </ComposerFrame>
      </DropZone>

      {error ? (
        <div className="w-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] leading-relaxed text-destructive">
          {error}
        </div>
      ) : (
        // One spinner for one send, and it is on the button that started it. This
        // line only says WHICH of the three steps that spinner is on — and says
        // nothing at rest, where the composer explains itself. Its height is held
        // either way, so the card does not move when the send begins.
        <p aria-live="polite" className="min-h-4 text-center text-[12px] text-muted-foreground">
          {progress(phase, reading.slug, files.length)}
        </p>
      )}
    </div>
  )
}

/** What the send is doing, step by step — the domain is scaffolded, not conjured. */
function progress(phase: NewDomainPhase, slug: string, files: number): string {
  switch (phase) {
    case 'creating':
      return `Creating ${slug} — scaffolding and installing its dependencies. This takes a moment…`
    case 'attaching':
      return `Adding ${files} file${files === 1 ? '' : 's'} to it…`
    case 'briefing':
      return 'Handing your message to its agent…'
    // Nothing to announce before the send: a name and a message are their own
    // instructions, and a line explaining them only got in their way.
    case 'idle':
      return ''
  }
}

/** A file waiting on the domain that will hold it — the chip a document wears. */
function StagedChip({
  file,
  disabled,
  onRemove,
}: {
  file: File
  disabled?: boolean
  onRemove: () => void
}) {
  const kind = kindOf(file)
  return (
    <span className={cn(CHIP, 'border-border bg-muted/60')}>
      <span
        className="flex min-w-0 items-center gap-1.5 pr-1"
        title={`${file.name} — ${fmtSize(file.size)}`}
      >
        <kind.Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{file.name}</span>
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        title={`Remove ${file.name}`}
        aria-label={`Remove ${file.name}`}
        className="mr-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
