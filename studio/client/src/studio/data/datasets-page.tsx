/**
 * The Datasets page: the Data level of a Domain with no dataset chosen. It lists every Dataset the
 * Domain references, each as a card that says what it is, where its module is, what it holds and
 * how it stands against the Schema — admitted, admitted against another revision, or not read and
 * why — and opens it. A Domain that references none is told what a Dataset is, where one is
 * declared, and, when it is the Workspace's to write, can hand the agent the request to write one.
 */

import type {
  StudioDataset,
  StudioDatasetFailure,
  StudioSchemaBundle,
} from '@shared/contracts/schema'

import { AlertTriangle, ChevronRight, Database } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'

import { DescriptionText, Surface } from '@/components/studio-kit'
import { useBundle, useDatasets } from '@/lib/hooks'
import { useOnScreen } from '@/lib/notices'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { SECTION_MARKS } from '../inspector/marks'
import { rulesOf } from '../rules/model'
import { Callout, PageHeader } from '../workspace/header'
import { identitiesOf } from './access'
import { DATA_SECTIONS, DataMark, OUTCOME_MARKS } from './marks'
import { admittedSentence, datasetLabel, datasetModel } from './model'
import { DATASET_DEFINITION, NoDataset, useAskForDataset } from './no-dataset'
import { DataWait } from './wait'

type Entry = StudioDataset | StudioDatasetFailure

/** What a Dataset holds; its identities once the Domain's rules can tell which Classes are. */
export interface Holdings {
  readonly nodes: number
  readonly edges: number
  readonly classes: number
  readonly identities?: number
}

export function holdingsOf(dataset: StudioDataset, bundle?: StudioSchemaBundle): Holdings {
  const model = datasetModel(dataset, bundle)
  const catalogue = bundle ? rulesOf(bundle).catalogue : undefined
  return {
    nodes: model.order.length,
    edges: model.edges.length,
    classes: model.classes.length,
    ...(catalogue ? { identities: identitiesOf(model, catalogue).length } : {}),
  }
}

/** How a Dataset stands against the Schema, as its card says it. */
export type Standing = 'admitted' | 'other-revision' | 'unreadable'

export function standingOf(entry: Entry): Standing {
  if (entry.status === 'failed') return 'unreadable'
  return entry.schemaMatch ? 'admitted' : 'other-revision'
}

export function DatasetsPage({
  domainId,
  origin,
  since,
}: {
  domainId: string
  origin: string
  /** when the reader asked for the page, in epoch milliseconds: its wait's clock */
  since: number
}) {
  const datasets = useDatasets(domainId)
  const bundle = useBundle(domainId)
  const openDataLevel = useUI((s) => s.openDataLevel)
  const { ask, asking } = useAskForDataset({ id: domainId, origin })
  useOnScreen(datasets.data || datasets.isError ? { level: 'data', domainId } : undefined)
  if (datasets.isError)
    return (
      <DatasetsView
        origin={origin}
        failure={datasets.error instanceof Error ? datasets.error.message : String(datasets.error)}
        onOpen={openDataLevel}
      />
    )
  if (!datasets.data)
    return (
      <DataWait
        since={since}
        dataset={`the datasets of ${origin}`}
        reading={`Reading the datasets ${origin} declares`}
      />
    )
  return (
    <DatasetsView
      origin={origin}
      entries={datasets.data.datasets}
      {...(bundle.data ? { bundle: bundle.data } : {})}
      onOpen={openDataLevel}
      {...(ask ? { onAsk: ask } : {})}
      asking={asking}
    />
  )
}

/** The page as drawn from what it is given: the Domain's datasets, or why they could not be read. */
export function DatasetsView({
  origin,
  entries = [],
  failure,
  bundle,
  onOpen,
  onAsk,
  asking = false,
}: {
  origin: string
  entries?: readonly Entry[]
  /** why the datasets could not be extracted */
  failure?: string
  bundle?: StudioSchemaBundle
  onOpen: (path: string) => void
  onAsk?: () => void
  asking?: boolean
}) {
  const state = failure !== undefined ? 'error' : entries.length === 0 ? 'none' : 'some'
  let body: ReactNode
  if (failure !== undefined)
    body = (
      <Callout>
        The datasets could not be extracted: <span className="font-mono">{failure}</span>
      </Callout>
    )
  else if (entries.length === 0) body = <NoDataset {...(onAsk ? { onAsk } : {})} asking={asking} />
  else
    body = (
      <>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {DATASET_DEFINITION}{' '}
          {entries.length === 1
            ? 'This Domain references one: open it to read it through the lenses.'
            : `This Domain references ${entries.length} Datasets: open one to read it through the lenses.`}
        </p>
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.path}>
              <DatasetCard entry={entry} bundle={bundle} onOpen={() => onOpen(entry.path)} />
            </li>
          ))}
        </ul>
      </>
    )
  return (
    <div
      data-testid="datasets-page"
      data-state={state}
      className="h-full w-full overflow-y-auto bg-canvas"
    >
      <div className="mx-auto max-w-2xl space-y-5 px-6 pb-24 pt-8">
        <PageHeader kicker="Datasets" icon={<Database />} name={origin} />
        {body}
      </div>
    </div>
  )
}

const HOLDING_MARKS = {
  nodes: { ...DATA_SECTIONS.nodes, word: 'Nodes' },
  edges: { ...SECTION_MARKS.relationships, word: 'Edges' },
  classes: { ...DATA_SECTIONS.classes, word: 'Classes' },
  identities: { ...DATA_SECTIONS.identities, word: 'Identities' },
}

const STANDING_MARKS = {
  admitted: { ...OUTCOME_MARKS.allowed, word: 'Admitted' },
  'other-revision': { ...OUTCOME_MARKS.unknown, word: 'Another Schema revision' },
}

function DatasetCard({
  entry,
  bundle,
  onOpen,
}: {
  entry: Entry
  bundle?: StudioSchemaBundle
  onOpen: () => void
}) {
  const standing = standingOf(entry)
  const holdings = useMemo(
    () => (entry.status === 'ready' ? holdingsOf(entry, bundle) : undefined),
    [bundle, entry],
  )
  return (
    <Surface
      data-dataset-card={entry.path}
      data-standing={standing}
      className={cn(
        'group relative space-y-2.5 p-4 shadow-sm transition-colors hover:bg-accent/40',
        standing === 'unreadable' && 'border-destructive/30',
      )}
    >
      <div className="space-y-0.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {standing === 'unreadable' ? (
            <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-warning" />
          ) : (
            <Database aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {/* the whole card opens it: the title's button stretches over it */}
          <button
            type="button"
            data-action="open-dataset"
            onClick={onOpen}
            className="min-w-0 flex-1 truncate text-left after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/40"
          >
            {datasetLabel(entry)}
          </button>
          <ChevronRight
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
          />
        </h3>
        <p className="break-all font-mono text-[11.5px] text-muted-foreground">{entry.path}</p>
      </div>
      {entry.status === 'ready' && entry.description && (
        <DescriptionText className="line-clamp-3 text-[13px] leading-relaxed text-foreground/85">
          {entry.description}
        </DescriptionText>
      )}
      {holdings && (
        <p
          data-dataset-holdings=""
          className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px]"
        >
          <Holding mark={HOLDING_MARKS.nodes} count={holdings.nodes} one="Node" />
          <Holding mark={HOLDING_MARKS.edges} count={holdings.edges} one="Edge" />
          <Holding
            mark={HOLDING_MARKS.classes}
            count={holdings.classes}
            one="Class"
            many="Classes"
          />
          {holdings.identities !== undefined && (
            <Holding
              mark={HOLDING_MARKS.identities}
              count={holdings.identities}
              one="identity"
              many="identities"
            />
          )}
        </p>
      )}
      {entry.status === 'ready' ? (
        <p
          data-dataset-standing=""
          className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted-foreground"
        >
          <DataMark
            mark={STANDING_MARKS[entry.schemaMatch ? 'admitted' : 'other-revision']}
            className="mt-[3px] h-3.5 w-3.5"
          />
          {admittedSentence(entry)}
        </p>
      ) : (
        <div data-dataset-standing="" className="space-y-1.5">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Could not be read, so it holds no Node to draw. Opening it says where and why.
          </p>
          <pre
            data-dataset-reason=""
            className="max-h-28 overflow-hidden whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 font-mono text-[11.5px] text-destructive"
          >
            {entry.error.message}
          </pre>
        </div>
      )}
    </Surface>
  )
}

function Holding({
  mark,
  count,
  one,
  many = `${one}s`,
}: {
  mark: Parameters<typeof DataMark>[0]['mark']
  count: number
  one: string
  many?: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <DataMark mark={mark} className="h-3.5 w-3.5" />
      <span>
        <span className="tabular-nums">{count}</span> {count === 1 ? one : many}
      </span>
    </span>
  )
}
