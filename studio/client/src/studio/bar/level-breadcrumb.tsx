/**
 * The level breadcrumb: how far in the Studio reads — the Workspace, one Domain of it, and,
 * when one is open, a dataset of that Domain. The Workspace crumb opens the Workspace level,
 * which names no Domain. Each crumb past it switches what it names: another Domain is read at
 * the same level (a dataset level opens its first ready dataset); a dataset opens the Data
 * level on it, even one that could not be read, which then says why; "No dataset" goes back to
 * the Schema, the lens and selection kept. A Publication's crumb names its origin and version,
 * read-only, and has no dataset after it: a published bundle carries none.
 */

import type { DomainSummary } from '@shared/contracts/workspace'

import { publicationOf } from '@shared/contracts/versions'
import { isReadOnlyDomainId } from '@shared/contracts/workspace'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronRight, ChevronsUpDown, Database, Loader2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { AnchorButton } from '@/components/anchor'
import { DomainInstalledChip } from '@/components/instance-domains'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DomainPackageUpdates, UpdatesBadge } from '@/components/updates-badge'
import { bundleQueryOptions } from '@/lib/domain-queries'
import { useDatasets } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { anchorData, domainAnchorRef, targetSurface } from '@/lib/targets'
import { cn } from '@/lib/utils'

import { loadDataLevel } from '../data/load'
import { datasetLabel } from '../data/model'
import { PublicationCrumb } from './publication-crumb'

const TRIGGER =
  'inline-flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[13px] transition-colors hover:bg-accent'
const OPTION =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-accent'

export function LevelBreadcrumb({
  domains,
  domainId,
  onDomainChange,
}: {
  domains: DomainSummary[]
  domainId?: string
  onDomainChange: (domainId: string) => void
}) {
  const atWorkspace = useUI((s) => s.level === 'workspace')
  const openWorkspace = useUI((s) => s.openWorkspace)
  const domain = atWorkspace ? undefined : domains.find((candidate) => candidate.id === domainId)
  // A Publication is no Domain of the Workspace: it has no installs, threads, updates or datasets.
  const publication = atWorkspace || !domainId ? undefined : publicationOf(domainId)
  return (
    <nav
      aria-label="Level"
      data-testid="level-breadcrumb"
      {...targetSurface('bar')}
      className="flex min-w-0 items-center"
    >
      {atWorkspace ? (
        <span
          aria-current="page"
          data-testid="level-workspace"
          className="shrink-0 px-1.5 text-[13px] font-semibold text-foreground"
        >
          Workspace
        </span>
      ) : (
        <button
          type="button"
          data-testid="level-workspace"
          title="Open the Workspace"
          onClick={openWorkspace}
          className={cn(TRIGGER, 'shrink-0 text-muted-foreground hover:text-foreground')}
        >
          Workspace
        </button>
      )}
      {publication && domainId && (
        <>
          <Separator />
          <PublicationCrumb domainId={domainId} publication={publication} domains={domains} />
        </>
      )}
      {domain && (
        <>
          <Separator />
          <DomainCrumb domains={domains} domain={domain} onDomainChange={onDomainChange} />
          {/* The Kernel has no installs, threads or package updates of its own. */}
          {!isReadOnlyDomainId(domain.id) && (
            <>
              <DomainInstalledChip origin={domain.origin} />
              <DomainPackageUpdates domainId={domain.id} origin={domain.origin} />
              <AnchorButton
                domainId={domain.id}
                anchorRef={{ ref: domainAnchorRef(domain.origin), kind: 'section' }}
                excerpt={domain.origin}
              />
            </>
          )}
          <UpdatesBadge domainId={domain.id} domainPath={domain.path} />
          <Separator />
          <DatasetCrumb domainId={domain.id} />
        </>
      )}
    </nav>
  )
}

function Separator() {
  return <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
}

function Choice({
  current,
  onPick,
  title,
  children,
}: {
  current: boolean
  onPick: () => void
  title?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={current}
      onClick={onPick}
      title={title}
      className={cn(OPTION, current ? 'font-medium text-foreground' : 'text-muted-foreground')}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {current && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
    </button>
  )
}

function DomainCrumb({
  domains,
  domain,
  onDomainChange,
}: {
  domains: DomainSummary[]
  domain: DomainSummary
  onDomainChange: (domainId: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="level-domain"
          // targeting mode attaches a thread, or an Ask, to the whole Domain from here
          {...anchorData(domainAnchorRef(domain.origin), domain.origin, domain.id)}
          title="Switch Domain"
          className={cn(TRIGGER, 'font-semibold text-foreground')}
        >
          <span className="truncate">{domain.origin}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" role="menu" className="w-64 p-1">
        {domains.map((candidate) => (
          <Choice
            key={candidate.id}
            current={candidate.id === domain.id}
            onPick={() => {
              setOpen(false)
              if (candidate.id !== domain.id) onDomainChange(candidate.id)
            }}
          >
            {candidate.origin}
          </Choice>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/**
 * The dataset crumb. A Domain's datasets are extracted once its Schema has answered — the
 * extraction builds on the same bundle, and never delays its first read — so the crumb lists
 * them, and the first open of one waits on nothing already asked. Hovering or focusing the crumb
 * loads the Data level's code.
 */
function DatasetCrumb({ domainId }: { domainId: string }) {
  const [open, setOpen] = useState(false)
  const reading = useUI((s) => s.level === 'data')
  const datasetPath = useUI((s) => s.dataset)
  const openSchema = useUI((s) => s.openSchema)
  const openDataLevel = useUI((s) => s.openDataLevel)
  // read, not asked: the Schema level asks for its bundle
  const schemaAnswered = !useQuery({ ...bundleQueryOptions(domainId), enabled: false }).isPending
  const { data, isError } = useDatasets(domainId, { enabled: open || reading || schemaAnswered })
  const entries = data?.datasets ?? []
  // the Data level reads the dataset named, read or not
  const current = reading ? (entries.find((entry) => entry.path === datasetPath) ?? null) : null

  const preload = () => void loadDataLevel()
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) preload()
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="level-dataset"
          title="Open a dataset"
          onPointerEnter={preload}
          onFocus={preload}
          className={cn(TRIGGER, current ? 'font-medium text-foreground' : 'text-muted-foreground')}
        >
          {current?.status === 'failed' ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          ) : (
            current && <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">
            {current ? datasetLabel(current) : reading ? 'Dataset' : 'No dataset'}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" role="menu" className="w-72 p-1">
        <Choice
          current={!reading}
          onPick={() => {
            setOpen(false)
            openSchema()
          }}
        >
          No dataset
        </Choice>
        <div className="my-1 h-px bg-border" />
        {!data ? (
          <p className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-muted-foreground">
            {!isError && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isError ? 'Datasets unavailable.' : 'Extracting datasets…'}
          </p>
        ) : entries.length === 0 ? (
          <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No Dataset referenced</p>
        ) : (
          // a dataset that could not be read keeps its place: opening it says where and why
          entries.map((entry) => (
            <Choice
              key={entry.path}
              current={entry.path === current?.path}
              title={entry.status === 'failed' ? entry.error.message : entry.path}
              onPick={() => {
                setOpen(false)
                openDataLevel(entry.path)
              }}
            >
              {datasetLabel(entry)}
              {entry.status === 'failed' && (
                <span className="ml-1.5 text-[11px] font-normal text-warning">
                  could not be read
                </span>
              )}
            </Choice>
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}
