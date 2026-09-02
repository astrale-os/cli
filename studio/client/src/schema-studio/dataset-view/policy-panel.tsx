/**
 * policy-panel.tsx — one policy, explained on the selected Dataset.
 *
 * Top to bottom: what the rule says, where the schema uses it, and what the demo data proves —
 * every (subject, object) pair the rule connects, or the verdict for the two the reader picked.
 * Picking happens here (two selects) or on the canvas (a click on a card), and either way the
 * canvas paints the proof green or the pair red.
 */
import type { IrSchemaRef, StudioCore, StudioSchemaBundle } from '@shared/types'

import { Check, ShieldCheck, X } from 'lucide-react'
import { useMemo } from 'react'

import { Chip } from '@/components/studio-kit'
import { type Policy, type PolicyGuard, type PolicyIndex, type PolicyUsage } from '@/lib/policy'
import { cn } from '@/lib/utils'

import type { DataGraph } from './policy-graph'

import { resolveClass } from '../inheritance'
import { edgeLabel, nodeLabel, sameObject } from './model'
import {
  type PolicyEvaluation,
  type PolicyMatch,
  type PolicyObject,
  objectKey,
} from './policy-evaluate'
import { ExpressionWords, checkObjectWords } from './policy-words'

const GUARD_LABEL: Record<PolicyGuard, string> = {
  object: 'guards a node',
  edge: 'guards an edge',
  subject: 'about the subject',
}

export interface PolicyPick {
  subject: string | null
  object: PolicyObject | null
}

function Heading({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </div>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

const SELECT =
  'h-7 w-full min-w-0 rounded-md border bg-card px-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40'

function NodeSelect({
  value,
  ids,
  core,
  placeholder,
  onChange,
}: {
  value: string | null
  ids: readonly string[]
  core: StudioCore
  placeholder: string
  onChange: (id: string | null) => void
}) {
  // grouped by class so a long Dataset still reads
  const groups = useMemo(() => {
    const byClass = new Map<string, string[]>()
    for (const id of ids) {
      const node = core.nodes.find((candidate) => candidate.path === id)
      const cls = node?.className ?? '?'
      byClass.set(cls, [...(byClass.get(cls) ?? []), id])
    }
    return [...byClass.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [ids, core])
  return (
    <select
      className={SELECT}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {groups.map(([cls, members]) => (
        <optgroup key={cls} label={cls}>
          {members.map((id) => (
            <option key={id} value={id}>
              {nodeLabel(core, id)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function EdgeSelect({
  value,
  indexes,
  core,
  onChange,
}: {
  value: number | null
  indexes: readonly number[]
  core: StudioCore
  onChange: (index: number | null) => void
}) {
  return (
    <select
      className={SELECT}
      value={value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">Any edge</option>
      {indexes.map((index) => (
        <option key={index} value={index}>
          {edgeLabel(core, index)}
        </option>
      ))}
    </select>
  )
}

export function PolicyPanel({
  policy,
  index,
  bundle,
  guard,
  usage,
  dataset,
  pick,
  overview,
  verdict,
  guardedEdges,
  onPick,
  onOpen,
}: {
  policy: Policy
  index: PolicyIndex
  bundle: StudioSchemaBundle
  guard: PolicyGuard
  usage: PolicyUsage
  /** the Dataset the proofs run on; null when none is ready */
  dataset: { core: StudioCore; graph: DataGraph; label: string } | null
  pick: PolicyPick
  /** every proof in the Dataset, regardless of the pick */
  overview: { evaluation: PolicyEvaluation; matches: PolicyMatch[] } | null
  /** the proofs under the pick, when anything is picked */
  verdict: { evaluation: PolicyEvaluation; matches: PolicyMatch[] } | null
  guardedEdges: readonly string[]
  onPick: (pick: PolicyPick) => void
  onOpen: (key: string) => void
}) {
  const undirected = (ref: IrSchemaRef) =>
    resolveClass(bundle, { ...ref, kind: 'class' })?.orientation === 'undirected'

  const subjects = useMemo(() => {
    if (!dataset) return []
    return dataset.graph.identities.length > 0 ? dataset.graph.identities : dataset.graph.nodeIds
  }, [dataset])
  const objectNodes = dataset?.graph.nodeIds ?? []
  const objectEdges = useMemo(() => {
    if (!dataset) return []
    const names = guardedEdges.length ? new Set(guardedEdges) : null
    return dataset.graph.edges
      .filter((edge) => !names || names.has(edge.edgeName))
      .map((edge) => edge.index)
  }, [dataset, guardedEdges])

  const picked = pick.subject !== null || pick.object !== null
  const decided = pick.subject !== null && (guard === 'subject' || pick.object !== null)
  const shown = picked ? verdict : overview
  const proofs = shown?.evaluation.status === 'ok' ? shown.evaluation.proofs.length : 0
  const allowed = decided && proofs > 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center gap-2.5 border-b px-4 py-3 pr-12">
        <span className="shrink-0 text-success">
          <ShieldCheck className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{policy.ref.name}</div>
          <div className="text-[11px] text-muted-foreground">{GUARD_LABEL[guard]}</div>
        </div>
      </div>

      <div className="space-y-5 px-4 py-4">
        {policy.description && (
          <p className="text-[13px] leading-relaxed text-foreground/80">{policy.description}</p>
        )}

        <section className="space-y-2">
          <Heading>Rule</Heading>
          <div className="rounded-md border bg-card px-3 py-2.5">
            <ExpressionWords
              policy={policy}
              index={index}
              onOpen={onOpen}
              undirected={undirected}
            />
          </div>
        </section>

        <section className="space-y-2.5">
          <Heading hint={dataset ? dataset.label : undefined}>On the demo data</Heading>
          {!dataset ? (
            <p className="text-[12px] text-muted-foreground">
              Pick a Dataset in the rail to prove this policy on it.
            </p>
          ) : overview?.evaluation.status === 'unsupported' ? (
            <p className="text-[12px] text-warning">
              Cannot be proven here: {overview.evaluation.reason}.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-[12px]">
                <span className="text-muted-foreground">Subject</span>
                <NodeSelect
                  value={pick.subject}
                  ids={subjects}
                  core={dataset.core}
                  placeholder="Any identity"
                  onChange={(subject) => onPick({ ...pick, subject })}
                />
                {guard === 'object' && (
                  <>
                    <span className="text-muted-foreground">Object</span>
                    <NodeSelect
                      value={pick.object?.kind === 'node' ? pick.object.id : null}
                      ids={objectNodes}
                      core={dataset.core}
                      placeholder="Any node"
                      onChange={(id) =>
                        onPick({ ...pick, object: id ? { kind: 'node', id } : null })
                      }
                    />
                  </>
                )}
                {guard === 'edge' && (
                  <>
                    <span className="text-muted-foreground">Edge</span>
                    <EdgeSelect
                      value={pick.object?.kind === 'edge' ? pick.object.index : null}
                      indexes={objectEdges}
                      core={dataset.core}
                      onChange={(edgeIndex) =>
                        onPick({
                          ...pick,
                          object: edgeIndex === null ? null : { kind: 'edge', index: edgeIndex },
                        })
                      }
                    />
                  </>
                )}
              </div>
              {dataset.graph.identities.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No node of this Dataset descends from the kernel Identity, so any node may stand
                  as the subject.
                </p>
              )}

              {decided ? (
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium',
                    allowed
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-destructive/40 bg-destructive/10 text-destructive',
                  )}
                >
                  {allowed ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  {allowed
                    ? `Allowed — ${proofs} proof${proofs === 1 ? '' : 's'}`
                    : 'Denied — no proof connects them'}
                  <button
                    type="button"
                    onClick={() => onPick({ subject: null, object: null })}
                    className="ml-auto text-[11px] font-normal text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between text-[12px]">
                  <span className={cn(proofs > 0 ? 'text-success' : 'text-muted-foreground')}>
                    {proofs === 0
                      ? picked
                        ? 'Nothing matches this pick'
                        : 'No proof in this Dataset'
                      : `${shown?.matches.length ?? 0} match${(shown?.matches.length ?? 0) === 1 ? '' : 'es'} lit on the canvas`}
                    {shown?.evaluation.status === 'ok' && shown.evaluation.truncated
                      ? ' (truncated)'
                      : ''}
                  </span>
                  {picked && (
                    <button
                      type="button"
                      onClick={() => onPick({ subject: null, object: null })}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                Click a card on the canvas to pick it: an identity becomes the subject, anything
                else the object{guard === 'edge' ? ' — or click an edge' : ''}.
              </p>

              {shown && shown.matches.length > 0 && (
                <MatchTable
                  matches={shown.matches}
                  core={dataset.core}
                  guard={guard}
                  pick={pick}
                  onPick={onPick}
                />
              )}
            </>
          )}
        </section>

        <section className="space-y-2">
          <Heading>Used by</Heading>
          {usage.classes.length === 0 && usage.callables.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Declared but not attached to any class or callable yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {usage.classes.map((use) => (
                <Chip
                  key={`${use.className}.${use.operation}`}
                  tone={use.type === 'edge' ? 'edge' : 'node'}
                >
                  {use.className} · {use.operation}
                </Chip>
              ))}
              {usage.callables.map((use, i) => (
                <Chip
                  key={i}
                  tone="fn"
                  title={use.composed ? 'one check among several' : undefined}
                >
                  {use.ownerKind === 'class' ? `${use.owner}.${use.name}` : use.name} ·{' '}
                  {checkObjectWords(use.object)}
                  {use.composed ? ' *' : ''}
                </Chip>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** Every pair the rule connects; a row picks both ends, so the canvas shows that one proof. */
function MatchTable({
  matches,
  core,
  guard,
  pick,
  onPick,
}: {
  matches: PolicyMatch[]
  core: StudioCore
  guard: PolicyGuard
  pick: PolicyPick
  onPick: (pick: PolicyPick) => void
}) {
  const rows = useMemo(
    () =>
      [...matches].sort((left, right) =>
        `${left.subject ?? ''}${objectKey(left.object)}`.localeCompare(
          `${right.subject ?? ''}${objectKey(right.object)}`,
        ),
      ),
    [matches],
  )
  return (
    <div className="divide-y overflow-hidden rounded-md border bg-card">
      {rows.slice(0, 200).map((match) => {
        const active = match.subject === pick.subject && sameObject(match.object, pick.object)
        return (
          <button
            key={`${match.subject}|${objectKey(match.object)}`}
            type="button"
            onClick={() => onPick({ subject: match.subject, object: match.object })}
            className={cn(
              'flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] hover:bg-accent',
              active && 'bg-accent',
            )}
          >
            <span className="min-w-0 truncate font-medium">
              {match.subject ? nodeLabel(core, match.subject) : 'anyone'}
            </span>
            {guard !== 'subject' && (
              <>
                <span className="shrink-0 text-muted-foreground">→</span>
                <span className="min-w-0 truncate text-foreground/80">
                  {match.object?.kind === 'node'
                    ? `${nodeLabel(core, match.object.id)}`
                    : match.object?.kind === 'edge'
                      ? edgeLabel(core, match.object.index)
                      : '—'}
                </span>
              </>
            )}
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {match.proofs === 1 ? '' : `${match.proofs}×`}
            </span>
          </button>
        )
      })}
      {rows.length > 200 && (
        <div className="px-2.5 py-1 text-[11px] text-muted-foreground">
          {rows.length - 200} more…
        </div>
      )}
    </div>
  )
}
