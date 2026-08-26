import type { StudioCore, StudioSchemaBundle } from '@shared/types'

import { Box, FolderClosed, Spline } from 'lucide-react'
import { useMemo } from 'react'

import { Commentable } from '@/components/commentable'

import { moduleTint } from '../palette'
import { SchemaIcon } from '../schema-icon'
import {
  classIcon,
  coreDataEntries,
  displayName,
  fmtVal,
  hueMapOf,
  lastSeg,
  nodeAnchor,
} from './model'

// ── right panel: the selected node's detail ─────────────────────────────────

export function CoreDetail({
  core,
  bundle,
  selectedPath,
}: {
  core: StudioCore
  bundle: StudioSchemaBundle
  selectedPath: string | null
}) {
  const node = useMemo(
    () => core.nodes.find((n) => n.path === selectedPath) ?? null,
    [core, selectedPath],
  )
  const hues = useMemo(() => hueMapOf(core), [core])

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a core node to see what's set on it.
      </div>
    )
  }

  const hue = hues.get(node.className) ?? 264
  const icon = classIcon(bundle, node.className)
  const isFolder = node.className === 'Folder'
  const entries = coreDataEntries(node.data)
  const relatedEdges = core.edges.filter((e) => e.from === node.path || e.to === node.path)

  return (
    <div className="h-full overflow-y-auto">
      <Commentable
        anchor={{ ref: nodeAnchor(node.path), kind: 'section' }}
        excerpt={`${displayName(node)} (${node.className})`}
        className="block"
      >
        <div className="flex items-center gap-2.5 border-b px-4 py-3">
          <span style={{ color: moduleTint(hue).mark }} className="shrink-0">
            {icon ? (
              <SchemaIcon svg={icon} className="h-7 w-7" />
            ) : isFolder ? (
              <FolderClosed className="h-6 w-6" />
            ) : (
              <Box className="h-6 w-6" />
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{displayName(node)}</div>
            <div className="text-[11px] font-mono text-muted-foreground">{node.className}</div>
          </div>
        </div>
      </Commentable>

      <div className="px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Path
        </div>
        <div className="mt-1 break-all font-mono text-[11px] text-foreground/80">{node.path}</div>
      </div>

      <div className="px-4 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Data
        </div>
        {entries.length === 0 ? (
          <p className="mt-1 text-[12px] text-muted-foreground">No fields set.</p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {entries.map(({ key, label, value }) => (
              <div
                key={key}
                className="flex flex-col gap-0.5 rounded-md border bg-card px-2.5 py-1.5"
              >
                <span
                  className="font-mono text-[11px] text-muted-foreground"
                  title={label === key ? undefined : key}
                >
                  {label}
                </span>
                <span className="break-words text-[13px] text-foreground/80">{fmtVal(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {relatedEdges.length > 0 && (
        <div className="px-4 pb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Edges
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {relatedEdges.map((e, i) => {
              const outgoing = e.from === node.path
              const other = outgoing ? e.to : e.from
              return (
                <div key={`${e.edgeName}-${i}`} className="flex items-center gap-1.5 text-[12px]">
                  <Spline className="h-3.5 w-3.5 shrink-0 text-schema-edge" />
                  <span className="font-mono text-schema-edge">{e.edgeName}</span>
                  <span className="text-muted-foreground">{outgoing ? '→' : '←'}</span>
                  <span className="truncate text-foreground/80" title={other}>
                    {lastSeg(other)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
