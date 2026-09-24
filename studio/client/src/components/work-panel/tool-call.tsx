import type { AgentToolCall, AgentToolContent } from '@shared/types'
import type { ReactNode } from 'react'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Fragment } from 'react'

import { Markdown } from '@/components/markdown'
import { api, qk } from '@/lib/api'
import { lineDiff } from '@/lib/line-diff'
import { cn } from '@/lib/utils'

/** A block of verbatim text: wrapped to the panel, and scrolled past a few screens' worth. */
function Verbatim({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={cn(
        'max-h-60 overflow-auto whitespace-pre-wrap rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/85 [overflow-wrap:anywhere]',
        className,
      )}
    >
      {text}
    </pre>
  )
}

/** A value short enough to read on the line of its name. */
function inline(value: unknown): boolean {
  if (typeof value === 'string') return value.length <= 120 && !value.includes('\n')
  return value === null || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * The text of a list of text blocks - the shape MCP and the model API give a
 * tool's result, and so what a raw output very often is.
 */
function blocksText(value: unknown[]): string | undefined {
  const texts = value.map((block) => {
    const { type, text } = (block ?? {}) as { type?: unknown; text?: unknown }
    return type === 'text' && typeof text === 'string' ? text : undefined
  })
  return texts.length && texts.every((text) => text !== undefined) ? texts.join('\n') : undefined
}

/**
 * What a tool was given or gave back, verbatim. An object reads as its fields -
 * a command, a path, a pattern - each on its own line; anything nested, or too
 * long for a line, as the text it is.
 */
function RawValue({ value }: { value: unknown }) {
  if (typeof value === 'string') return <Verbatim text={value} />
  if (value === null || typeof value !== 'object')
    return <code className="font-mono text-foreground/85">{String(value)}</code>
  if (Array.isArray(value))
    return <Verbatim text={blocksText(value) ?? JSON.stringify(value, null, 2)} />
  const fields = Object.entries(value)
  if (!fields.length) return <span className="text-muted-foreground">Nothing.</span>
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
      {fields.map(([name, field]) => (
        <Fragment key={name}>
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="min-w-0">
            {inline(field) ? (
              <span className="whitespace-pre-wrap font-mono text-foreground/85 [overflow-wrap:anywhere]">
                {String(field)}
              </span>
            ) : (
              <Verbatim text={typeof field === 'string' ? field : JSON.stringify(field, null, 2)} />
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

const SIGN = { same: ' ', removed: '-', added: '+' } as const

/** A file the call changed, line by line. */
function DiffView({ diff }: { diff: Extract<AgentToolContent, { type: 'diff' }> }) {
  // a narrow panel cuts the folder, never the file's own name
  const cut = diff.path.lastIndexOf('/') + 1
  return (
    <div className="overflow-hidden rounded border border-border">
      <p
        title={diff.path}
        className="flex min-w-0 border-b border-border bg-background/70 px-2 py-1 font-mono text-[11px]"
      >
        <span className="truncate text-muted-foreground">{diff.path.slice(0, cut)}</span>
        <span className="shrink-0 text-foreground/85">{diff.path.slice(cut)}</span>
      </p>
      <div className="max-h-60 overflow-auto bg-background/40 py-1 font-mono text-[11px] leading-relaxed">
        {lineDiff(diff.oldText, diff.newText).map((line, index) => (
          <div
            key={index}
            className={cn(
              'flex gap-2 px-2',
              line.kind === 'removed' && 'bg-destructive/10',
              line.kind === 'added' && 'bg-success/10',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'w-2 shrink-0 select-none text-muted-foreground',
                line.kind === 'removed' && 'text-destructive',
                line.kind === 'added' && 'text-success',
              )}
            >
              {SIGN[line.kind]}
            </span>
            <span className="min-w-0 whitespace-pre-wrap text-foreground/85 [overflow-wrap:anywhere]">
              {line.text || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Cut() {
  return (
    <p className="text-[11px] italic text-muted-foreground">Too long to show whole: cut here.</p>
  )
}

function ContentView({ content }: { content: AgentToolContent }) {
  switch (content.type) {
    case 'text':
      return (
        <div className="space-y-1">
          <div className="max-h-72 overflow-auto">
            <Markdown text={content.text} className="text-[12px]" />
          </div>
          {content.truncated && <Cut />}
        </div>
      )
    case 'diff':
      return (
        <div className="space-y-1">
          <DiffView diff={content} />
          {content.truncated && <Cut />}
        </div>
      )
    case 'resource':
      return (
        <div className="space-y-1">
          <p className="font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
            {content.label}
          </p>
          {content.text !== undefined && <Verbatim text={content.text} />}
          {content.truncated && <Cut />}
        </div>
      )
  }
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      {children}
    </section>
  )
}

/** Every string a value holds, however deep - what it already names. */
function strings(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') found.add(value)
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) strings(item, found)
  return found
}

/**
 * The files a call touched that nothing above already names: a read's path is
 * its input, an edit's is its diff, and saying either twice says nothing.
 */
function unnamedLocations(call: AgentToolCall): string[] {
  const named = strings(call.input)
  for (const content of call.content) if (content.type === 'diff') named.add(content.path)
  return call.locations.filter((location) => !named.has(location.replace(/:\d+$/, '')))
}

/** A call's details as the agent reported them: what it was given, what came back. */
export function ToolCallView({ call, running }: { call: AgentToolCall; running: boolean }) {
  const shows = call.content.length > 0 || call.output !== undefined
  const locations = unnamedLocations(call)
  return (
    <div className="space-y-2.5">
      {/* the input names what was called; without one, the call's own words do */}
      {call.input === undefined && (
        <p className="font-mono text-[11px] text-foreground/85 [overflow-wrap:anywhere]">
          {call.title}
        </p>
      )}
      {call.input !== undefined && (
        <Section label="Input">
          <RawValue value={call.input} />
        </Section>
      )}
      <Section label={call.status === 'failed' ? 'Error' : 'Output'}>
        {shows ? (
          <div className="space-y-2">
            {call.content.map((content, index) => (
              <ContentView key={index} content={content} />
            ))}
            {call.output !== undefined && <RawValue value={call.output} />}
          </div>
        ) : (
          <p className="text-muted-foreground">
            {running ? 'Waiting for the result…' : 'The agent reported no output.'}
          </p>
        )}
      </Section>
      {locations.length > 0 && (
        <Section label={locations.length === 1 ? 'File' : 'Files'}>
          <ul className="space-y-0.5 font-mono text-[11px] text-foreground/85">
            {locations.map((location) => (
              <li key={location} className="[overflow-wrap:anywhere]">
                {location}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

/**
 * The details behind one step, read when it is opened. Each report of the call
 * bumps its revision, so a step held open while the call runs reads it again -
 * and keeps showing what it had until the newer report lands.
 */
export function ToolCallDetails({
  chatId,
  runId,
  eventId,
  revision,
  running,
}: {
  chatId: string
  runId: string
  eventId: string
  revision: number
  /** the call may still report more - its turn is running and it has not settled */
  running: boolean
}) {
  const details = useQuery({
    queryKey: qk.agentToolCall(runId, eventId, revision),
    queryFn: () => api.agentToolCall(chatId, runId, eventId),
    // one revision never changes: once read, it is read for good
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  })

  return (
    <div
      data-testid="tool-call-details"
      className="mb-1.5 ml-[18px] mt-1 rounded-md border border-border bg-muted/40 p-2 text-[11.5px]"
    >
      {details.data ? (
        <ToolCallView call={details.data} running={running} />
      ) : details.isError ? (
        <p className="text-muted-foreground">The details of this step are no longer available.</p>
      ) : (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading…
        </p>
      )}
    </div>
  )
}
