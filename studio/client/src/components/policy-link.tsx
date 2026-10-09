import type { IrSchemaRef } from '@shared/types'

import { schemaRefKey } from '@shared/types'

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
