/**
 * node-access.tsx — what a node lets a caller do, under which rule.
 *
 * Under the node's data and edges, the Tests panel adds the access reading: the policy that
 * protects reading the node, and every callable its class offers with the policy each one
 * checks. Any rule is one click from being proven on this very node — the canvas then shows
 * who reaches it, in green.
 */
import type { StudioCoreNode, StudioSchemaBundle } from '@shared/types'

import { schemaRefKey } from '@shared/types'
import { Eye, ShieldCheck, Zap } from 'lucide-react'
import { useMemo } from 'react'

import { MethodAuthBadge } from '@/components/method-auth'
import { Chip } from '@/components/studio-kit'
import { methodGlyph } from '@/lib/friendly'
import {
  type PolicyCheckLeaf,
  type PolicyIndex,
  decodePolicyCheck,
  policyCheckLeaves,
  policyLabel,
} from '@/lib/policy'

import type { PolicyObject } from './policy-evaluate'

import { resolveClass } from '../inheritance'
import { classRefOf } from './policy-graph'
import { checkObjectWords } from './policy-words'

function PolicyButton({
  leaf,
  index,
  self,
  onProbe,
}: {
  leaf: PolicyCheckLeaf
  index: PolicyIndex
  self: string
  onProbe: (policyKey: string, object: PolicyObject | null) => void
}) {
  const key = schemaRefKey(leaf.check)
  const known = index.byKey.has(key)
  // `self` is this node; any other object is for the reader to pick in the policy panel
  const object: PolicyObject | null =
    leaf.object.kind === 'self' ? { kind: 'node', id: self } : null
  return (
    <button
      type="button"
      disabled={!known}
      onClick={() => onProbe(key, object)}
      title={known ? 'Prove this policy on the demo data' : 'Not declared by this domain'}
      className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success transition-colors hover:bg-success/20 disabled:opacity-50"
    >
      <ShieldCheck className="h-3 w-3" />
      {policyLabel(leaf.check, index.origin)} · {checkObjectWords(leaf.object)}
    </button>
  )
}

export function NodeAccess({
  bundle,
  node,
  index,
  onProbe,
}: {
  bundle: StudioSchemaBundle
  node: StudioCoreNode
  index: PolicyIndex
  onProbe: (policyKey: string, object: PolicyObject | null) => void
}) {
  const ir = bundle.ir
  const cls = useMemo(
    () => (ir ? resolveClass(bundle, classRefOf(node.className, ir.domain)) : undefined),
    [bundle, ir, node.className],
  )
  const read = cls?.policies?.read
  const callables = useMemo(
    () =>
      Object.entries(cls?.methods ?? {})
        .filter(([, method]) => !method.abstract && !method.static)
        .map(([name, method]) => ({ name, method, owner: cls!.name })),
    [cls],
  )

  if (!ir || !cls) return null

  return (
    <>
      <div className="px-4 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Access
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[12px]">
          <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">read</span>
          {read ? (
            <PolicyButton
              leaf={{ check: read, object: { kind: 'self' } }}
              index={index}
              self={node.path}
              onProbe={onProbe}
            />
          ) : (
            <span className="text-foreground/80">no policy — grants decide</span>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Callables on {cls.name}
        </div>
        {callables.length === 0 ? (
          <p className="mt-1 text-[12px] text-muted-foreground">This class declares no method.</p>
        ) : (
          <div className="mt-1.5 divide-y overflow-hidden rounded-md border bg-card">
            {callables.map(({ name, method, owner }) => {
              const glyph = methodGlyph(method)
              const Glyph = glyph.icon ?? Zap
              const check =
                method.policy === undefined ? undefined : decodePolicyCheck(method.policy)
              const leaves = check ? policyCheckLeaves(check) : []
              const composed = check && !('check' in check)
              return (
                <div key={`${owner}.${name}`} className="px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <Glyph className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{name}</span>
                    <MethodAuthBadge method={method} domainId={bundle.domainId} />
                    {method.static && <Chip tone="default">static</Chip>}
                    {owner !== cls.name && (
                      <span className="text-[11px] text-muted-foreground">from {owner}</span>
                    )}
                  </div>
                  {leaves.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1 pl-5">
                      {composed && (
                        <span className="text-[11px] text-muted-foreground">
                          {'allOf' in check ? 'all of' : 'any of'}
                        </span>
                      )}
                      {leaves.map((leaf, i) => (
                        <PolicyButton
                          key={i}
                          leaf={leaf}
                          index={index}
                          self={node.path}
                          onProbe={onProbe}
                        />
                      ))}
                    </div>
                  )}
                  {method.policy !== undefined && !check && (
                    <p className="mt-0.5 pl-5 text-[11px] text-warning">
                      policy check not readable
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
