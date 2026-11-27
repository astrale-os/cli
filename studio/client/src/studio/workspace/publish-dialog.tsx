/**
 * The Publish dialog: a fresh look, the choice of an Environment, exactly what will be published,
 * a confirmation the reader types, then the platform's progress and its final report or refusal.
 *
 * It only draws `usePublishRuns`: closing it never stops or loses a run, and reopening it shows
 * the run where it stands.
 */

import type { DomainStanding } from '@shared/contracts/versions'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef } from 'react'

import { MetaGrid } from '@/components/studio-kit'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { versionsApi, versionsKeys } from '@/lib/api'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'

import type { DomainFacts } from './facts'

import { Section } from '../inspector/parts'
import { originOf, valueOf } from './facts'
import { Callout } from './header'
import { BumpPhrase, ChangeGroups, ReportSentences, WORKSPACE_SECTIONS } from './marks'
import {
  confirmGate,
  IDLE_PUBLISH,
  lookFailureWords,
  NO_CHOICE,
  type ProgressLine,
  type PublishAction,
  type PublishChoice,
  type PublishState,
  type PublishStream,
  refusalAdvice,
  requestOf,
  resultSentences,
  runPublish,
  takeLook,
  usePublishRuns,
} from './publish'
import { sourceMark } from './use-facts'
import { counted, domainName, gitSentence, relationSentence, requiredBump } from './words'

export interface PublishDialogProps {
  domain: DomainFacts | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The stream to publish over; the Studio server's by default. Tests hand a fake. */
  publish?: PublishStream
}

export function PublishDialog({
  domain,
  open,
  onOpenChange,
  publish = versionsApi.publish,
}: PublishDialogProps) {
  const queryClient = useQueryClient()
  const id = domain?.summary.id ?? ''
  const state = usePublishRuns((store) => store.runs[id]) ?? { phase: 'idle' as const }
  const choice = usePublishRuns((store) => store.choices[id]) ?? NO_CHOICE
  const dispatchFor = usePublishRuns((store) => store.dispatch)
  const choose = usePublishRuns((store) => store.choose)
  const dispatch = useCallback(
    (action: PublishAction) => dispatchFor(id, action),
    [dispatchFor, id],
  )
  const current = useCallback(() => usePublishRuns.getState().runs[id] ?? IDLE_PUBLISH, [id])
  const local = domain ? valueOf(domain.local) : undefined
  const standing: DomainStanding | undefined = domain ? valueOf(domain.standing) : undefined

  const look = useCallback(async () => {
    if (!id) return
    const answer = await takeLook(async () => {
      const fresh = await versionsApi.changes(id, true)
      // the look is also the change report the panel shows
      queryClient.setQueryData([...versionsKeys.changes(id), sourceMark(local)], fresh)
      return fresh
    }, dispatch)
    return answer
  }, [dispatch, id, local, queryClient])

  // Opening the dialog takes a fresh look, unless a run is under way or has just ended; an open
  // dialog with no look at all takes one too, so "Taking a fresh look" is always true.
  const phase = state.phase
  const opened = useRef(false)
  useEffect(() => {
    if (!open) {
      opened.current = false
      return
    }
    const first = !opened.current
    opened.current = true
    if (phase === 'idle' || (first && (phase === 'review' || phase === 'look-failed'))) void look()
  }, [look, open, phase])

  // A Publish that ran changed the registry: every remote fact is read again.
  const settled = phase === 'published' || phase === 'failed' || phase === 'error'
  useEffect(() => {
    if (!settled) return
    void queryClient.invalidateQueries({ queryKey: ['versions'] })
    void queryClient.invalidateQueries({ queryKey: ['registry'] })
  }, [queryClient, settled])

  // Each new phase replaces the controls under the focus: it moves to the phase's first choice,
  // or to its last action once the run has answered, so the keyboard never lands on nothing.
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = body.current
    if (!open || !root) return
    const target =
      phase === 'review'
        ? root.querySelector<HTMLElement>('form input:not([disabled])')
        : [
            ...root.querySelectorAll<HTMLElement>('[data-publish-footer] button:not([disabled])'),
          ].at(-1)
    target?.focus()
  }, [open, phase])

  if (!domain) return null
  const origin = originOf(domain)
  const name = domainName(origin)

  const confirm = () => {
    if (state.phase !== 'review') return
    const gate = confirmGate(state.report, local, standing?.relation, choice)
    if (!gate.ready) return
    void runPublish(publish, id, requestOf(state.report, choice, gate), dispatch, current)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(88vh,760px)] max-w-xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
        data-publish-dialog={state.phase}
        onEscapeKeyDown={(event) => {
          // Esc closes the dialog; the run goes on and the panel says so
          event.stopPropagation()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Publish {name} {local?.declared ?? ''}
          </DialogTitle>
          <DialogDescription>
            A Publish deploys or reuses a release of {origin}, verifies it, and tags it in the
            registry. Nothing runs until you confirm.
          </DialogDescription>
        </DialogHeader>
        <div ref={body} className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <Body
            state={state}
            domain={domain}
            standing={standing}
            look={look}
            dispatch={dispatch}
            choose={(next) => choose(id, next)}
            choice={choice}
            confirm={confirm}
            retry={(request) => void runPublish(publish, id, request, dispatch, current)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Body({
  state,
  domain,
  standing,
  look,
  dispatch,
  choice,
  choose,
  confirm,
  retry,
}: {
  state: PublishState
  domain: DomainFacts
  standing: DomainStanding | undefined
  look: () => Promise<unknown>
  dispatch: (action: PublishAction) => void
  choice: PublishChoice
  choose: (choice: Partial<PublishChoice>) => void
  confirm: () => void
  retry: (request: Extract<PublishState, { phase: 'refused' }>['request']) => void
}) {
  const origin = originOf(domain)
  switch (state.phase) {
    case 'idle':
    case 'looking':
      return (
        <p role="status" aria-live="polite" className="text-[13px] text-muted-foreground">
          Taking a fresh look: the platform is judging the changes since the last Publication…
        </p>
      )
    case 'look-failed': {
      const words = lookFailureWords(state.failure, origin)
      return (
        <div className="space-y-3" role="alert">
          <Callout>
            {words.headline} {words.remedy}
          </Callout>
          <p className="break-words text-[12px] text-muted-foreground">
            {state.failure.message}
            {state.failure.code && <span className="ml-1.5 font-mono">{state.failure.code}</span>}
          </p>
          <p className="text-[13px]">
            Publish needs a change report taken now; without one nothing can be published.
          </p>
          <Footer>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
            <Button onClick={() => void look()}>Take a fresh look</Button>
          </Footer>
        </div>
      )
    }
    case 'review':
      return (
        <Review
          state={state}
          domain={domain}
          standing={standing}
          choice={choice}
          choose={choose}
          confirm={confirm}
          look={look}
        />
      )
    case 'starting':
    case 'running':
      return (
        <div className="space-y-3">
          <p role="status" aria-live="polite" className="text-[13px]">
            Publishing {state.report.declared} to {state.request.environment}…{' '}
            <span className="text-muted-foreground">
              You can close this dialog; the Publish goes on.
            </span>
          </p>
          {state.phase === 'running' && state.started && (
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              {state.started.command.join(' ')}
            </p>
          )}
          <Progress lines={state.phase === 'running' ? state.lines : []} />
        </div>
      )
    case 'published':
      return (
        <div className="space-y-3" data-publish-result="published">
          <div role="status" className="space-y-1 text-[13px] leading-relaxed">
            {resultSentences(state.result).map((sentence, index) => (
              <p key={index} className={index === 0 ? 'font-medium' : undefined}>
                {sentence}
              </p>
            ))}
          </div>
          <MetaGrid
            items={[
              { label: 'url', value: state.result.url },
              { label: 'release', value: state.result.releaseDigest },
              { label: 'build', value: state.result.buildDigest },
            ]}
          />
          <Progress lines={state.lines} unrelayed={state.unrelayedLines} />
          <Footer>
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          </Footer>
        </div>
      )
    case 'failed':
      return (
        <div className="space-y-3" data-publish-result="failed">
          <div role="alert" className="space-y-1">
            <Callout>
              The platform did not publish {state.report.declared}: {state.message}
            </Callout>
            <p className="text-[12px] text-muted-foreground">
              It exited with code {state.exitCode}. Its own lines are below; fix what they name,
              then take a fresh look.
            </p>
          </div>
          <Progress lines={state.lines} unrelayed={state.unrelayedLines} />
          <Footer>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
            <Button onClick={() => void look()}>Take a fresh look</Button>
          </Footer>
        </div>
      )
    case 'refused': {
      const advice = refusalAdvice(state.refusal)
      return (
        <div className="space-y-3" data-publish-result="refused" data-refusal={state.refusal.error}>
          <div role="alert" className="space-y-1.5">
            <Callout>
              <span className="font-medium">{advice.headline}</span> {advice.remedy}
            </Callout>
            <p className="break-words text-[12px] text-muted-foreground">
              {state.refusal.message}
              <span className="ml-1.5 font-mono">{state.refusal.error}</span>
            </p>
            <p className="text-[12px] text-muted-foreground">
              Nothing ran: the Studio refused before publishing.
            </p>
          </div>
          <Footer>
            <DialogClose asChild>
              <Button variant={advice.action === 'none' ? 'default' : 'outline'}>Close</Button>
            </DialogClose>
            {advice.action === 'look-again' && (
              <Button onClick={() => void look()}>Take a fresh look</Button>
            )}
            {advice.action === 'choose-environment' && (
              <Button onClick={() => dispatch({ type: 'revise' })}>
                Choose another Environment
              </Button>
            )}
            {advice.action === 'try-again' && (
              <Button onClick={() => retry(state.request)}>Try again</Button>
            )}
          </Footer>
        </div>
      )
    }
    case 'error':
      return (
        <div className="space-y-3" data-publish-result="error">
          <div role="alert" className="space-y-1.5">
            <Callout>The Publish stream broke: {state.message}</Callout>
            <p className="text-[13px] leading-relaxed">
              Whether the platform finished is not known. Read the registry again before publishing
              again: the Domain's standing shows whether {state.report.declared} was tagged.
            </p>
          </div>
          <Progress lines={state.lines} />
          <Footer>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
            <Button onClick={() => void look()}>Take a fresh look</Button>
          </Footer>
        </div>
      )
  }
}

function Review({
  state,
  domain,
  standing,
  choice,
  choose,
  confirm,
  look,
}: {
  state: Extract<PublishState, { phase: 'review' }>
  domain: DomainFacts
  standing: DomainStanding | undefined
  choice: PublishChoice
  choose: (choice: Partial<PublishChoice>) => void
  confirm: () => void
  look: () => Promise<unknown>
}) {
  const local = valueOf(domain.local)
  const report = state.report
  const relation = standing?.relation
  const gate = confirmGate(report, local, relation, choice)
  const bump = requiredBump(report)
  const environments = local?.environments.environments ?? []
  const typedId = useId()
  const missingId = useId()
  const origin = originOf(domain)
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        confirm()
      }}
    >
      <section
        className="space-y-1.5 text-[13px] leading-relaxed"
        aria-label="What will be published"
      >
        <p>
          <span className="font-medium">
            {origin} {report.declared}
          </span>
          {bump && report.changes.length > 0 && (
            <>
              , <BumpPhrase bump={bump} />
            </>
          )}
          .
        </p>
        <p className="text-muted-foreground">
          The registry was read again for this look; the changes were judged{' '}
          {relativeTime(report.judgedAt)} — a judgement is kept while the version, revision, SDK and
          Publications stay the same.
        </p>
        <ReportSentences report={report} className="text-muted-foreground" />
        <ChangeGroups
          changes={report.changes}
          origin={origin}
          domainId={domain.summary.id}
          limit={5}
          lineClassName="text-[12px]"
        />
      </section>

      {relation?.kind === 'behind' && (
        <Callout>{relationSentence(relation, standing!.local)}</Callout>
      )}
      {relation?.kind === 'version-taken' && (
        <Callout>{relationSentence(relation, standing!.local)}</Callout>
      )}
      {standing === undefined && (
        <Callout tone="quiet">
          Where {domainName(origin)} stands against its latest Publication is not known yet.
        </Callout>
      )}

      <Section label="Environment" kind={WORKSPACE_SECTIONS.environment}>
        {!local?.environments.declared ? (
          <p className="text-[13px]">
            The Project declares no Environment: declare one in astrale.config.ts.
          </p>
        ) : environments.length === 0 ? (
          <p className="text-[13px]">No Environment of the Project is statically readable.</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Environment">
            {environments.map((environment) => (
              <label
                key={environment.name}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] transition-colors focus-within:ring-2 focus-within:ring-ring/40',
                  choice.environment === environment.name
                    ? 'border-primary bg-primary/6'
                    : 'hover:bg-accent',
                )}
              >
                <input
                  type="radio"
                  name="publish-environment"
                  value={environment.name}
                  checked={choice.environment === environment.name}
                  onChange={() => choose({ environment: environment.name })}
                  className="accent-primary"
                />
                <span className="font-mono">{environment.name}</span>
                {environment.adapter && (
                  <span className="text-[11px] text-muted-foreground">
                    {environment.adapter.export}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
        {local && !local.environments.complete && (
          <p className="text-[12px] text-muted-foreground">
            Some entries are not statically readable: the Project may declare more.
          </p>
        )}
      </Section>

      {gate.needsAllowDirty && (
        <div className="space-y-1.5">
          <Callout tone="quiet">{gitSentence(local?.git ?? null)}</Callout>
          <label className="flex cursor-pointer items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={choice.allowDirty}
              onChange={(event) => choose({ allowDirty: event.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 accent-primary"
            />
            <span>
              {local?.git === null
                ? 'Publish without recording a commit'
                : 'Publish the uncommitted changes as they are'}{' '}
              <span className="font-mono text-[12px] text-muted-foreground">(--allow-dirty)</span>
            </span>
          </label>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={typedId} className="block text-[13px]">
          Type <span className="font-mono font-medium">{report.declared}</span> to confirm
        </label>
        <input
          id={typedId}
          value={choice.typed}
          onChange={(event) => choose({ typed: event.target.value })}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={gate.ready ? undefined : missingId}
          className="h-9 w-full rounded-md border bg-transparent px-3 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          placeholder={report.declared}
        />
        {!gate.ready && (
          <ul
            id={missingId}
            aria-live="polite"
            className="space-y-0.5 text-[12px] text-muted-foreground"
          >
            {gate.missing.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>

      <Footer>
        <Button type="button" variant="ghost" onClick={() => void look()}>
          Take a fresh look
        </Button>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!gate.ready} data-action="confirm-publish">
          {choice.environment
            ? `Publish ${report.declared} to ${choice.environment}`
            : `Publish ${report.declared}`}
        </Button>
      </Footer>
    </form>
  )
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-1" data-publish-footer>
      {children}
    </div>
  )
}

const LINE_TONE: Record<ProgressLine['tone'], string> = {
  step: 'text-foreground/80',
  warning: 'text-warning',
  refusal: 'text-destructive',
}

const LINE_MARK: Record<ProgressLine['tone'], string> = { step: '›', warning: '!', refusal: '✗' }

function Progress({ lines, unrelayed }: { lines: readonly ProgressLine[]; unrelayed?: number }) {
  if (lines.length === 0 && !unrelayed) return null
  return (
    <div className="space-y-1">
      <ol
        role="log"
        aria-live="polite"
        aria-label="Publish progress"
        className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-[12px]"
      >
        {lines.map((line, index) => (
          <li key={index} className={cn('break-words', LINE_TONE[line.tone])}>
            <span aria-hidden className="mr-1.5">
              {LINE_MARK[line.tone]}
            </span>
            {line.line}
          </li>
        ))}
      </ol>
      {unrelayed ? (
        <p className="text-[11px] text-muted-foreground">
          {counted(unrelayed, 'other output line')} of adapters and tools{' '}
          {unrelayed === 1 ? 'was' : 'were'} not relayed.
        </p>
      ) : null}
    </div>
  )
}
