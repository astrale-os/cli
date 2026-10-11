import type { IrSchemaRef } from '@shared/schema/identity'
import type { ReactNode } from 'react'

import { schemaRefKey } from '@shared/schema/identity'

import { type PolicyCheck, type PolicyCheckLeaf, policyObjectLabel } from '@/lib/policy'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

/** Open the policy's declaration in Schema, keeping the callable's owning domain. */
export function PolicyLink({
  policy,
  domainId,
  className,
  label,
}: {
  policy: IrSchemaRef
  domainId: string
  className?: string
  label?: string
}) {
  const key = schemaRefKey(policy)
  return (
    <button
      type="button"
      title={`Open ${key}`}
      className={cn(
        'rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation()
        const ui = useUI.getState()
        ui.setSection('schema')
        ui.selectClass(`policy.${key}`, domainId)
      }}
    >
      {label ?? policy.name}
    </button>
  )
}

/** Every condition of a callable's policy check and its grouping, each leaf drawn by `renderCheck`. */
export function PolicyCheckTree({
  check,
  owner = 'receiver',
  renderCheck,
}: {
  check: PolicyCheck
  /** what `self` reads as: the Class on screen, or the generic receiver */
  owner?: string
  renderCheck: (leaf: PolicyCheckLeaf) => ReactNode
}) {
  if ('check' in check) return renderCheck(check)
  if ('sameNode' in check)
    return (
      <span>
        {policyObjectLabel(check.sameNode.left, owner)} is the same Node as{' '}
        {policyObjectLabel(check.sameNode.right, owner)}
      </span>
    )
  const items = 'allOf' in check ? check.allOf : check.anyOf
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground">{'allOf' in check ? 'all of' : 'any of'}</div>
      <div className="space-y-1 border-l pl-2.5">
        {items.map((item, i) => (
          <PolicyCheckTree key={i} check={item} owner={owner} renderCheck={renderCheck} />
        ))}
      </div>
    </div>
  )
}
