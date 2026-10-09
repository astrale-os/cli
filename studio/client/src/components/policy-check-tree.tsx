import type { ReactNode } from 'react'

import { type PolicyCheck, type PolicyCheckLeaf, policyObjectLabel } from '@/lib/policy'

/** Keep every condition and its grouping visible in callable authorization summaries. */
export function PolicyCheckTree({
  check,
  renderCheck,
}: {
  check: PolicyCheck
  renderCheck: (leaf: PolicyCheckLeaf) => ReactNode
}) {
  if ('check' in check) return renderCheck(check)
  if ('sameNode' in check)
    return (
      <span>
        {policyObjectLabel(check.sameNode.left, 'receiver')} is the same Node as{' '}
        {policyObjectLabel(check.sameNode.right, 'receiver')}
      </span>
    )
  const items = 'allOf' in check ? check.allOf : check.anyOf
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground">{'allOf' in check ? 'all of' : 'any of'}</div>
      <div className="space-y-1.5 border-l pl-2.5">
        {items.map((item, i) => (
          <PolicyCheckTree key={i} check={item} renderCheck={renderCheck} />
        ))}
      </div>
    </div>
  )
}
