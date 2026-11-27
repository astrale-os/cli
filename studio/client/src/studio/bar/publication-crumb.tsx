/**
 * The crumb of a Publication read in Studio: its origin and version, marked read-only. Its menu
 * says what the published bundle declares and the digests that name it, then leads back — to
 * the Workspace, to the Workspace's own copy of the origin, and to each workspace Domain built
 * against the origin, saying which of them is built against this version.
 */

import type { PublicationAddress, PublishedSchemaBundle } from '@shared/contracts/versions'
import type { DomainSummary } from '@shared/contracts/workspace'

import { isReadOnlyDomainId } from '@shared/contracts/workspace'
import { useQuery } from '@tanstack/react-query'
import { ChevronsUpDown, Lock } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Chip, MetaGrid } from '@/components/studio-kit'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { versionsApi, versionsKeys } from '@/lib/api'
import { bundleQueryOptions, remoteFailureOf } from '@/lib/domain-queries'
import { useUI } from '@/lib/store'
import { anchorData, domainAnchorRef } from '@/lib/targets'
import { cn } from '@/lib/utils'

import { counted, failureWords } from '../workspace/words'

const TRIGGER =
  'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] transition-colors hover:bg-accent'
const OPTION =
  'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground'

export function PublicationCrumb({
  domainId,
  publication,
  domains,
}: {
  domainId: string
  publication: PublicationAddress
  /** the Workspace's Domains */
  domains: readonly DomainSummary[]
}) {
  const [open, setOpen] = useState(false)
  const { origin, version } = publication
  const bundle = useQuery(bundleQueryOptions(domainId))
  const read = bundle.data as PublishedSchemaBundle | undefined
  const openWorkspace = useUI((s) => s.openWorkspace)
  const openDomain = useUI((s) => s.openDomain)
  const local = domains.find((domain) => domain.origin === origin && !isReadOnlyDomainId(domain.id))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="level-domain"
          data-publication-crumb={`${origin}@${version}`}
          // targeting mode asks about the whole Publication from here
          {...anchorData(domainAnchorRef(origin), `${origin} ${version}`, domainId)}
          title="A Publication, read-only"
          className={cn(TRIGGER, 'font-semibold text-foreground')}
        >
          <span className="truncate">{origin}</span>
          <span className="shrink-0 font-mono text-[12px] font-medium text-muted-foreground">
            {version}
          </span>
          <Chip tone="outline" className="shrink-0" data-testid="read-only">
            <Lock className="h-3 w-3" />
            read-only
          </Chip>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-[26rem] space-y-3 p-3">
        <div className="space-y-2" data-publication-summary="">
          <p className="text-[13px] font-medium">
            Publication {origin} {version}
          </p>
          {read ? (
            <PublishedSummary bundle={read} />
          ) : bundle.isError ? (
            <p className="text-[12.5px] text-muted-foreground">
              {
                failureWords(
                  remoteFailureOf(bundle.error) ?? { status: 'failed' },
                  `${origin} ${version}`,
                ).headline
              }
            </p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Reading {origin} {version} from the registry…
            </p>
          )}
          <p className="text-[12px] text-muted-foreground">
            Read-only: it is the registry's, and nothing here changes it. Its arrangement is kept on
            this machine, apart from every Domain folder.
          </p>
        </div>
        <div className="h-px bg-border" />
        <div role="menu" className="-mx-1 space-y-0.5">
          <Option
            onPick={() => {
              setOpen(false)
              openWorkspace()
            }}
          >
            Back to the Workspace
          </Option>
          {local && (
            <Option
              onPick={() => {
                setOpen(false)
                openDomain(local.id)
              }}
            >
              {origin} <span className="text-[11.5px]">as this Workspace holds it</span>
            </Option>
          )}
          {open && (
            <Dependents
              origin={origin}
              revision={read?.publication.schemaRevision}
              domains={domains}
              onOpen={(id) => {
                setOpen(false)
                openDomain(id)
              }}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Option({ onPick, children }: { onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onPick} className={OPTION}>
      {children}
    </button>
  )
}

/** The workspace Domains built against `origin`, read from their sources: no registry call. */
function Dependents({
  origin,
  revision,
  domains,
  onOpen,
}: {
  origin: string
  /** this Publication's Schema revision, once read */
  revision?: string
  domains: readonly DomainSummary[]
  onOpen: (domainId: string) => void
}) {
  const locals = useQuery({ queryKey: versionsKeys.locals, queryFn: versionsApi.locals })
  const dependents = (locals.data ?? []).flatMap((local) =>
    local.dependencies
      .filter((dependency) => dependency.origin === origin)
      .map((dependency) => ({ local, dependency })),
  )
  if (!locals.data) return null
  if (dependents.length === 0)
    return (
      <p className="px-2 py-1 text-[12px] text-muted-foreground">
        No workspace Domain is built against {origin}.
      </p>
    )
  return (
    <>
      <p className="px-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Built against {origin}
      </p>
      {dependents.map(({ local, dependency }) => (
        <Option key={`${local.domainId}:${dependency.alias}`} onPick={() => onOpen(local.domainId)}>
          <span className="text-foreground">
            {local.origin ??
              domains.find((domain) => domain.id === local.domainId)?.origin ??
              local.domainId}
          </span>
          <span className="text-[11.5px]">
            {revision === undefined
              ? `as ${dependency.alias}`
              : dependency.revision === revision
                ? `as ${dependency.alias}, on this version's Schema`
                : `as ${dependency.alias}, on another Schema revision`}
          </span>
        </Option>
      ))}
    </>
  )
}

/** What a published bundle holds, counted. */
function publishedCounts(bundle: PublishedSchemaBundle): {
  nodes: number
  edges: number
  methods: number
  functions: number
  views: number
} {
  const classes = Object.values(bundle.ir?.classes ?? {})
  return {
    nodes: classes.filter((entry) => entry.type === 'node').length,
    edges: classes.filter((entry) => entry.type === 'edge').length,
    methods: classes.reduce((total, entry) => total + Object.keys(entry.methods).length, 0),
    functions: Object.keys(bundle.ir?.functions ?? {}).length,
    views: Object.keys(bundle.ir?.views ?? {}).length,
  }
}

/** What a published bundle declares, and the digests that name it. */
function PublishedSummary({ bundle }: { bundle: PublishedSchemaBundle }) {
  const publication = bundle.publication
  const counts = publishedCounts(bundle)
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] leading-relaxed">
        It declares {counted(counts.nodes + counts.edges, 'Class', 'Classes')} ({counts.nodes} Node,{' '}
        {counts.edges} Edge) with {counted(counts.methods, 'Method')},{' '}
        {counted(counts.functions, 'function')} and {counted(counts.views, 'View')}.
        {publication.yanked && ' It is yanked.'}
      </p>
      <MetaGrid
        items={[
          { label: 'revision', value: publication.schemaRevision },
          { label: 'release', value: publication.releaseDigest },
          { label: 'bundle', value: publication.bundleDigest },
          { label: 'published', value: new Date(publication.publishedAt).toLocaleString() },
          {
            label: 'decoded by',
            value: `SDK ${publication.decodedBy.sdk}${publication.decodedBy.domainId ? ` (${publication.decodedBy.domainId})` : ''}`,
          },
        ]}
      />
    </div>
  )
}
