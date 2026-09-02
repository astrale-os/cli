import { schemaRefKey } from '@shared/types'
import { ReactFlowProvider } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ScrollArea } from '@/components/ui/misc'
import { useBundle, useDatasets } from '@/lib/hooks'
import { type PolicyGuard, indexPolicies, policyGuard, policyUsage } from '@/lib/policy'
import { useUI } from '@/lib/store'

import type { CoreSpotlight } from '../core-view/model'

import { CoreDetail, CoreView } from '../core-view'
import { DomainPicker, DomainsRailHeader } from '../domains-rail'
import { PanelShell } from '../panel-shell'
import { ModulesSidebar } from '../sidebar'
import { datasetCore, datasetLabel, isReadyDataset, proofSpotlight, sameObject } from './model'
import { NodeAccess } from './node-access'
import { DatasetPicker } from './picker'
import { PoliciesRail } from './policies-rail'
import {
  type PolicyEvaluation,
  type PolicyMatch,
  type PolicyObject,
  evaluatePolicy,
  groupProofs,
} from './policy-evaluate'
import { buildDataGraph } from './policy-graph'
import { type PolicyPick, PolicyPanel } from './policy-panel'
import { DatasetTree } from './tree'

/** A policy under study, with the subject and object the reader picked (either may be open). */
interface Probe extends PolicyPick {
  policyKey: string
}

interface Proofs {
  evaluation: PolicyEvaluation
  matches: PolicyMatch[]
}

const fold = (evaluation: PolicyEvaluation): Proofs => ({
  evaluation,
  matches: evaluation.status === 'ok' ? groupProofs(evaluation.proofs) : [],
})

/**
 * The test reading of ONE domain: the Datasets its project declares under `tests`, drawn with
 * the Core canvas, and the domain's policies proven on them. Clicking a card lifts what it is
 * wired to; picking a policy paints every proof the demo data holds, and picking a subject and
 * an object turns that into one verdict. Datasets are extracted on demand and never deployed,
 * so this section reads a separate query and stays alive when a Dataset module is broken.
 */
export function TestsSection({ domainId }: { domainId: string }) {
  const { data: bundle, isLoading } = useBundle(domainId)
  const { data: datasets, isLoading: extracting } = useDatasets(domainId)
  const setFocus = useUI((s) => s.setFocus)
  const select = useUI((s) => s.selectClass)
  const probePolicy = useUI((s) => s.probePolicy)
  const setProbePolicy = useUI((s) => s.setProbePolicy)

  // Which Dataset, which of its Nodes, which policy — local to this section, cleared with the
  // domain. A node selection and a policy probe exclude each other: the panel shows one thing.
  const [datasetId, setDatasetId] = useState<string | null>(null)
  const [nodePath, setNodePath] = useState<string | null>(null)
  const [probe, setProbe] = useState<Probe | null>(null)
  useEffect(() => {
    setDatasetId(null)
    setNodePath(null)
    setProbe(null)
  }, [domainId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      setFocus(null)
      select(undefined)
      setNodePath(null)
      setProbe(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setFocus, select])

  const ir = bundle?.ir ?? null
  const policyIndex = useMemo(() => (ir ? indexPolicies(ir) : null), [ir])
  const guards = useMemo(() => {
    const out = new Map<string, PolicyGuard>()
    if (policyIndex) {
      for (const policy of policyIndex.policies) {
        out.set(schemaRefKey(policy.ref), policyGuard(policy, policyIndex))
      }
    }
    return out
  }, [policyIndex])

  // A policy another section handed over: open it here, then forget the request.
  useEffect(() => {
    if (!probePolicy || !policyIndex) return
    const key = policyIndex.byKey.has(probePolicy)
      ? probePolicy
      : schemaRefKey({ origin: policyIndex.origin, kind: 'policy', name: probePolicy })
    if (policyIndex.byKey.has(key)) {
      setProbe({ policyKey: key, subject: null, object: null })
      setNodePath(null)
    }
    setProbePolicy(null)
  }, [probePolicy, policyIndex, setProbePolicy])

  const entries = useMemo(() => datasets?.datasets ?? [], [datasets])
  const ready = useMemo(() => entries.filter(isReadyDataset), [entries])
  const selected = ready.find((entry) => entry.id === datasetId) ?? ready[0] ?? null
  const core = useMemo(() => (selected ? datasetCore(selected) : null), [selected])
  const graph = useMemo(
    () => (core && bundle ? buildDataGraph(core, bundle) : null),
    [core, bundle],
  )

  const policy = probe && policyIndex ? (policyIndex.byKey.get(probe.policyKey) ?? null) : null
  const guard = probe ? (guards.get(probe.policyKey) ?? 'object') : null
  const usage = useMemo(() => (policy && ir ? policyUsage(ir, policy) : null), [policy, ir])
  const traversed = (use: NonNullable<typeof usage>) =>
    use.classes.filter((c) => c.operation === 'traverse').map((c) => c.className)
  const guardedEdges = useMemo(() => (usage ? traversed(usage) : []), [usage])

  // How many pairs each policy connects in this Dataset — the rail's counts.
  const counts = useMemo(() => {
    if (!graph || !policyIndex || !ir) return null
    const out = new Map<string, number | null>()
    for (const candidate of policyIndex.policies) {
      const evaluation = evaluatePolicy({
        policy: candidate,
        index: policyIndex,
        graph,
        guardedEdges: traversed(policyUsage(ir, candidate)),
      })
      out.set(
        schemaRefKey(candidate.ref),
        evaluation.status === 'ok' ? groupProofs(evaluation.proofs).length : null,
      )
    }
    return out
  }, [graph, policyIndex, ir])

  const overview = useMemo(
    () =>
      policy && graph && policyIndex
        ? fold(evaluatePolicy({ policy, index: policyIndex, graph, guardedEdges }))
        : null,
    [policy, graph, policyIndex, guardedEdges],
  )
  const picked = probe !== null && (probe.subject !== null || probe.object !== null)
  const verdict = useMemo(
    () =>
      picked && policy && graph && policyIndex
        ? fold(
            evaluatePolicy({
              policy,
              index: policyIndex,
              graph,
              guardedEdges,
              probe: { subject: probe.subject, object: probe.object },
            }),
          )
        : null,
    [picked, policy, graph, policyIndex, guardedEdges, probe],
  )

  const spotlight = useMemo<CoreSpotlight | null>(() => {
    if (!probe || !core) return null
    const shown = picked ? verdict : overview
    if (!shown || shown.evaluation.status !== 'ok') return null
    // green wherever a proof exists; red for a pick nothing connects; an unpicked policy
    // with no proof at all simply lights nothing
    const tone = shown.matches.length > 0 ? 'pass' : picked ? 'fail' : 'pass'
    return proofSpotlight(shown.matches, tone, probe, core)
  }, [probe, core, picked, verdict, overview])

  // ── picking on the canvas ──
  // Outside a probe a click selects the card. Inside one it picks an end of the proof: an
  // identity is the subject, anything else the object (when the policy guards a node).
  const onCanvasSelect = useCallback(
    (path: string | null) => {
      if (!probe || !graph || !guard) {
        setNodePath(path)
        return
      }
      if (path === null) {
        // empty space: drop the pick first, the policy second
        setProbe(picked ? { ...probe, subject: null, object: null } : null)
        return
      }
      const asSubject =
        graph.isIdentity(path) ||
        (graph.identities.length === 0 && (guard !== 'object' || probe.subject === null))
      if (asSubject) {
        setProbe({ ...probe, subject: probe.subject === path ? null : path })
      } else if (guard === 'object') {
        const object: PolicyObject = { kind: 'node', id: path }
        setProbe({ ...probe, object: sameObject(probe.object, object) ? null : object })
      }
    },
    [probe, graph, guard, picked],
  )
  const onEdgeClick = useCallback(
    (index: number) => {
      if (!probe || guard !== 'edge') {
        if (!probe) setNodePath(null)
        return
      }
      const object: PolicyObject = { kind: 'edge', index }
      setProbe({ ...probe, object: sameObject(probe.object, object) ? null : object })
    },
    [probe, guard],
  )
  const openPolicy = useCallback((policyKey: string, object: PolicyObject | null = null) => {
    setProbe({ policyKey, subject: null, object })
    setNodePath(null)
  }, [])

  if (isLoading || !bundle) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Introspecting schema…
      </div>
    )
  }

  const selectedNode =
    nodePath && core ? (core.nodes.find((n) => n.path === nodePath) ?? null) : null

  return (
    <div className="h-full flex flex-col">
      {bundle.error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/30 text-warning text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{bundle.error.message}</span>
        </div>
      )}
      {selected && !selected.schemaMatch && (
        <div className="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/30 text-warning text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Dataset “{datasetLabel(selected)}” was admitted against another schema revision; it is
            re-extracted once the schema settles.
          </span>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <ModulesSidebar
          onClearSelection={() => {
            setNodePath(null)
            setProbe(null)
          }}
          header={<DomainsRailHeader />}
        >
          <ScrollArea className="h-full">
            <DomainPicker>
              {datasets ? (
                <DatasetPicker
                  datasets={entries}
                  selectedId={selected?.id ?? null}
                  onSelect={(id) => {
                    setDatasetId(id)
                    setNodePath(null)
                    // the policy stays: it is the domain's, the proofs are re-read on the new data
                    setProbe((current) => current && { ...current, subject: null, object: null })
                  }}
                />
              ) : (
                <p className="px-3 py-2 text-[12px] text-muted-foreground">
                  {extracting ? 'Extracting datasets…' : 'Datasets unavailable.'}
                </p>
              )}
              {policyIndex && (
                <PoliciesRail
                  index={policyIndex}
                  guards={guards}
                  counts={counts}
                  selectedKey={probe?.policyKey ?? null}
                  onSelect={(key) => (probe?.policyKey === key ? setProbe(null) : openPolicy(key))}
                />
              )}
              {selected && core && (
                <DatasetTree
                  dataset={selected}
                  core={core}
                  bundle={bundle}
                  selectedPath={nodePath}
                  onSelect={onCanvasSelect}
                />
              )}
            </DomainPicker>
          </ScrollArea>
        </ModulesSidebar>
        <div className="flex-1 min-w-0 relative">
          {/* One ReactFlow store per domain AND Dataset: switching either must start fresh. */}
          <ReactFlowProvider key={`${domainId}:${selected?.id ?? ''}`}>
            {core ? (
              <CoreView
                core={core}
                bundle={bundle}
                selectedPath={probe ? null : nodePath}
                onSelect={onCanvasSelect}
                spotlight={spotlight}
                onEdgeClick={onEdgeClick}
                // demo facts read by name and class; their data waits in the panel
                compact
                commentable={false}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-6 text-center">
                {!datasets
                  ? 'Extracting datasets…'
                  : entries.length === 0
                    ? 'No Dataset referenced by this project.'
                    : 'No Dataset could be extracted; see the rail for details.'}
              </div>
            )}
          </ReactFlowProvider>
        </div>
        {probe && policy && guard && usage && policyIndex ? (
          <PanelShell onClose={() => setProbe(null)}>
            <PolicyPanel
              policy={policy}
              index={policyIndex}
              bundle={bundle}
              guard={guard}
              usage={usage}
              dataset={
                core && graph && selected ? { core, graph, label: datasetLabel(selected) } : null
              }
              pick={probe}
              overview={overview}
              verdict={verdict}
              guardedEdges={guardedEdges}
              onPick={(pick) => setProbe({ ...probe, ...pick })}
              onOpen={(key) => openPolicy(key)}
            />
          </PanelShell>
        ) : (
          nodePath &&
          core && (
            <PanelShell onClose={() => setNodePath(null)}>
              <CoreDetail core={core} bundle={bundle} selectedPath={nodePath} commentable={false}>
                {selectedNode && policyIndex && (
                  <NodeAccess
                    bundle={bundle}
                    node={selectedNode}
                    index={policyIndex}
                    onProbe={openPolicy}
                  />
                )}
              </CoreDetail>
            </PanelShell>
          )
        )}
      </div>
    </div>
  )
}
