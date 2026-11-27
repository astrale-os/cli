/**
 * A Domain that references no Dataset, said where the reader meets it. The dataset crumb's menu
 * says what a Dataset is (`NoDatasetNote`); the Datasets page also says where one is declared
 * (`NoDataset`). Both offer, on a Domain of the Workspace, the one action that hands the agent
 * the request to write one: left unsent in a new chat, for the reader to review.
 */

import type { DomainSummary } from '@shared/contracts/workspace'

import { isReadOnlyDomainId } from '@shared/contracts/workspace'
import { Database, Sparkles } from 'lucide-react'

import { Surface } from '@/components/studio-kit'
import { Button } from '@/components/ui/button'
import { usePrepareAgentRequest } from '@/lib/chats'
import { cn } from '@/lib/utils'

export const DATASET_DEFINITION =
  'A Dataset is a small graph of Nodes and Edges, written in code, that the Data level draws and the Rules lens decides on.'

/** Where a Dataset is declared: its module, whose one export is the Dataset… */
const MODULE = 'tests/datasets/<name>.ts'
const MODULE_LINE = 'export default defineDataset(schema, { id, title, graph })'
/** …and the line of `astrale.config.ts` that lists it, as `defineProject` reads it. */
const CONFIG_LINE = `tests: tests({ datasets: [dataset('./${MODULE}')] })`

/** The request the agent is handed: a demo Dataset of this Domain, declared where the Studio reads it. */
export function datasetRequest(origin: string): string {
  return [
    `Write a demo Dataset for the ${origin} Domain, so the Studio's Data level can draw it and its Rules lens can decide on it. Load the astrale-domain skill and follow its Dataset reference.`,
    `Declare it in ${MODULE}, a module whose only export is the default one, defineDataset(schema, { id, title, description, graph }) from @astrale-os/sdk/testing, and list it in astrale.config.ts:\n${CONFIG_LINE}`,
    'Use only the Classes, Edges, properties and states the Schema declares, with believable values. Include identities its Policies treat differently, one of them with no access, and return variables naming those identities and the key Nodes. Change nothing else: not the Schema, the Policies or the functions.',
  ].join('\n\n')
}

/** The request to write a Dataset of `domain`; none on a read-only Domain, which has no file to write. */
export function useAskForDataset(domain: Pick<DomainSummary, 'id' | 'origin'>): {
  ask?: () => void
  asking: boolean
} {
  const { prepare, preparing } = usePrepareAgentRequest()
  if (isReadOnlyDomainId(domain.id)) return { asking: false }
  return {
    ask: () =>
      void prepare(
        datasetRequest(domain.origin),
        'Dataset request ready — review it, then send when you are ready',
      ),
    asking: preparing,
  }
}

/**
 * The menu's word for a Domain with no Dataset: what one is, where it is declared, the page that
 * shows the two lines to write, and the request.
 */
export function NoDatasetNote({
  onAsk,
  asking = false,
  onDeclared,
}: {
  onAsk?: () => void
  asking?: boolean
  /** opens the Datasets page, which shows the two lines that declare a Dataset */
  onDeclared: () => void
}) {
  return (
    <div data-no-dataset="note" className="space-y-2 px-2 pb-2 pt-1.5">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
        <Database aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        No Dataset referenced
      </p>
      <p className="text-xs leading-5 text-muted-foreground">{DATASET_DEFINITION}</p>
      <p className="text-xs leading-5 text-muted-foreground">
        It is a module defined with <Code>defineDataset</Code> from{' '}
        <Code>@astrale-os/sdk/testing</Code>, listed in <Code>astrale.config.ts</Code>.{' '}
        <button
          type="button"
          data-action="dataset-declaration"
          onClick={onDeclared}
          className="rounded-sm text-foreground underline decoration-foreground/20 underline-offset-[3px] transition-colors hover:decoration-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          Show the code
        </button>
      </p>
      {onAsk && <AskForDataset onAsk={onAsk} asking={asking} />}
    </div>
  )
}

/** The Datasets page of a Domain with none: what a Dataset is, where it is declared, the request. */
export function NoDataset({ onAsk, asking = false }: { onAsk?: () => void; asking?: boolean }) {
  return (
    <Surface data-no-dataset="page" className="space-y-4 p-5 shadow-sm">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Database aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          No Dataset referenced
        </h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{DATASET_DEFINITION}</p>
      </div>
      <div className="space-y-2">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          It is a module of the Domain, whose one export is the Dataset, defined with{' '}
          <Code>defineDataset</Code> from <Code>@astrale-os/sdk/testing</Code>…
        </p>
        <Declaration file={MODULE} line={MODULE_LINE} />
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          …and listed in the Domain's configuration:
        </p>
        <Declaration file="astrale.config.ts" line={CONFIG_LINE} />
      </div>
      {onAsk && <AskForDataset onAsk={onAsk} asking={asking} wide={false} />}
    </Surface>
  )
}

function AskForDataset({
  onAsk,
  asking,
  wide = true,
}: {
  onAsk: () => void
  asking: boolean
  wide?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="sm"
        className={cn(wide && 'w-full')}
        data-action="ask-dataset"
        disabled={asking}
        onClick={onAsk}
      >
        <Sparkles aria-hidden /> Ask the agent to write one
      </Button>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Opens a new agent chat with an unsent request. You can review or edit it before sending.
      </p>
    </div>
  )
}

/** One line of code, under the file it is written in. */
function Declaration({ file, line }: { file: string; line: string }) {
  return (
    <figure className="overflow-hidden rounded-md border bg-muted/40">
      <figcaption className="border-b px-2 py-1 font-mono text-[10.5px] text-muted-foreground">
        {file}
      </figcaption>
      <code className="block overflow-x-auto whitespace-pre p-2 font-mono text-[11px] text-foreground">
        {line}
      </code>
    </figure>
  )
}

function Code({ children }: { children: string }) {
  return (
    <code className="whitespace-nowrap font-mono text-[11.5px] text-foreground/85">{children}</code>
  )
}
