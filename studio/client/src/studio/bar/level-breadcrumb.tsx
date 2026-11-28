/**
 * The level breadcrumb: how far in the Studio reads — the Workspace, or one Domain of it. The
 * Workspace crumb opens the Workspace level, which names no Domain. The Domain crumb switches
 * Domain, read at the same level (at the Data level, on its Datasets page). A Publication's crumb
 * names its origin and version, read-only. Whether a Domain's Schema or its Data is read is the
 * Schema | Data switch's (`level-switch.tsx`).
 */

import type { DomainSummary } from '@shared/contracts/workspace'

import { publicationOf } from '@shared/contracts/versions'
import { isReadOnlyDomainId } from '@shared/contracts/workspace'
import { Check, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { AnchorButton } from '@/components/anchor'
import { DomainInstalledChip } from '@/components/instance-domains'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DomainPackageUpdates, UpdatesBadge } from '@/components/updates-badge'
import { useUI } from '@/lib/store'
import { anchorData, domainAnchorRef, targetSurface } from '@/lib/targets'
import { cn } from '@/lib/utils'

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
  // A Publication is no Domain of the Workspace: it has no installs, threads or updates.
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
          // the Domain's name is the last crumb to give way: a few letters of it always read
          className={cn(TRIGGER, 'min-w-18 font-semibold text-foreground')}
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
