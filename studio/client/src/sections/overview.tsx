import type { AnchorRef } from '@shared/types'
import type { ReactNode } from 'react'

import {
  AlertTriangle,
  Box,
  GitBranch,
  Hash,
  Layers,
  Link2,
  Package,
  Server,
  Tag,
} from 'lucide-react'

import { Commentable } from '@/components/commentable'
import {
  DetailsDisclosure,
  Group,
  IconTile,
  Row,
  SectionShell,
  Surface,
} from '@/components/studio-kit'
import { shortHash } from '@/lib/format'
import { useAnatomy, useBundle } from '@/lib/hooks'

/** A single stat tile: tinted icon, value, quiet label below. */
function StatTile({
  icon,
  tone,
  value,
  label,
  trailing,
}: {
  icon: ReactNode
  tone: string
  value: ReactNode
  label: string
  trailing?: ReactNode
}) {
  return (
    <Surface className="flex items-center gap-3 px-4 py-3.5">
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight">{value}</div>
        <div className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </Surface>
  )
}

export function OverviewSection({ domainId }: { domainId: string }) {
  const bundleQ = useBundle(domainId)
  const anatomyQ = useAnatomy(domainId)

  const bundle = bundleQ.data
  const anatomy = anatomyQ.data

  if (bundleQ.isLoading || anatomyQ.isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!bundle || !anatomy) {
    return (
      <SectionShell title="Overview">
        <Surface className="px-4 py-3 text-sm text-muted-foreground">
          No overview data available for this domain.
        </Surface>
      </SectionShell>
    )
  }

  const ov = anatomy.overview
  const origin = bundle.overlay.origin
  const ir = bundle.ir

  const classCount = ir ? Object.values(ir.classes).filter((c) => c.type === 'node').length : 0
  const edgeCount = ir ? Object.values(ir.classes).filter((c) => c.type === 'edge').length : 0
  const interfaceCount = ir ? Object.keys(ir.interfaces).length : 0

  const astraleDeps = Object.entries(ov.astraleDeps ?? {})
  const version = ov.packageVersion

  const subtitle = `${ov.adapter}${ov.prodTarget ? ` · deploys to ${ov.prodTarget}` : ''}`

  const sectionAnchor: AnchorRef = { ref: 'section.overview', kind: 'section', file: 'domain.ts' }
  const statsAnchor: AnchorRef = {
    ref: 'section.overview.stats',
    kind: 'section',
    file: 'domain.ts',
  }
  const depsAnchor: AnchorRef = { ref: 'section.overview.deps', kind: 'section', file: 'domain.ts' }

  return (
    <SectionShell title={origin} subtitle={subtitle}>
      {bundle.error && (
        <Commentable
          anchor={sectionAnchor}
          excerpt={`Schema warning: ${bundle.error.message}`}
          className="mb-8"
        >
          <Surface className="flex items-start gap-3 border-warning/40 bg-warning/10 px-4 py-3.5">
            <IconTile tone="amber">
              <AlertTriangle />
            </IconTile>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-warning">Schema extraction warning</div>
              <div className="mt-0.5 text-[13px] leading-snug text-warning/90">
                {bundle.error.message}
              </div>
              {bundle.error.file && (
                <div className="mt-1 font-mono text-xs text-warning/70">{bundle.error.file}</div>
              )}
            </div>
          </Surface>
        </Commentable>
      )}

      <Commentable anchor={statsAnchor} excerpt={`${origin} — schema & build`} className="mb-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile icon={<Box />} tone="violet" value={classCount} label="Classes" />
          <StatTile icon={<Layers />} tone="sky" value={interfaceCount} label="Interfaces" />
          <StatTile icon={<Link2 />} tone="fuchsia" value={edgeCount} label="Edges" />
          <StatTile
            icon={<Hash />}
            tone="muted"
            value={<span className="font-mono">{shortHash(bundle.schemaHash)}</span>}
            label="Schema"
          />
          <StatTile
            icon={<Package />}
            tone={bundle.depsInstalled ? 'emerald' : 'amber'}
            value={bundle.depsInstalled ? 'Installed' : 'Missing'}
            label="Dependencies"
          />
          <StatTile icon={<GitBranch />} tone="muted" value="No git" label="Git" />
          <StatTile
            icon={<Server />}
            tone="muted"
            value={ov.prodTarget ?? '—'}
            label="Deploys to"
          />
          <StatTile
            icon={<Tag />}
            tone="muted"
            value={version ? <span className="font-mono">{version}</span> : '—'}
            label="Version"
          />
        </div>

        {bundle.overlay.postInstall && (
          <div className="mt-3 px-1 font-mono text-xs text-muted-foreground">
            <span className="text-muted-foreground/60">postinstall </span>
            {bundle.overlay.postInstall}
          </div>
        )}
      </Commentable>

      {astraleDeps.length > 0 && (
        <Commentable anchor={depsAnchor} excerpt="@astrale-os dependencies">
          <Group>
            <DetailsDisclosure label="Dependencies">
              <div className="flex flex-col gap-px">
                {astraleDeps.map(([name, range]) => (
                  <Row
                    key={name}
                    leading={
                      <IconTile tone="muted" size="sm">
                        <Package />
                      </IconTile>
                    }
                    title={<span className="font-mono text-[13px]">{name}</span>}
                    trailing={
                      <span className="font-mono text-xs text-muted-foreground">{range}</span>
                    }
                  />
                ))}
              </div>
            </DetailsDisclosure>
          </Group>
        </Commentable>
      )}
    </SectionShell>
  )
}
