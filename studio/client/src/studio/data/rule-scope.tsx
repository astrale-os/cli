/**
 * A rule read on the dataset: the reader's scope around it, in English, carrying the dataset and
 * the case a verdict was decided for — the caller, and the Node or Edge asked — so its words, its
 * walk and its Figure are drawn on that case, the verdict's proof marked. What is pinned in it is
 * that rule's alone, in that case, as `RuleHost` pins it at the Schema level.
 */

import type { Data, FactId, Rule, Selection, Situation } from '@astrale-os/visual'

import { RuleScope } from '@astrale-os/visual/react'
import { type ReactNode, useCallback, useState } from 'react'

import { cn } from '@/lib/utils'

/** The case a rule is read in: the caller, and the Node or Edge it was decided on. */
export interface DecidedCase {
  readonly situation: Situation
  readonly fact?: FactId
}

export function DatasetRule({
  rule,
  data,
  decided,
  className,
  children,
}: {
  rule: Rule
  /** the dataset it is decided on; none, or no case, reads its words alone */
  data?: Data
  decided?: DecidedCase
  className?: string
  children: ReactNode
}) {
  const [pinned, setPinned] = useState<{
    rule: Rule
    decided?: DecidedCase
    selection: Selection
  }>()
  const onSelectionChange = useCallback(
    (selection: Selection) => setPinned({ rule, ...(decided ? { decided } : {}), selection }),
    [decided, rule],
  )
  return (
    <RuleScope
      className={cn('studio-rules outline-none', className)}
      rule={rule}
      locale="en"
      {...(data && decided
        ? {
            data,
            situation: decided.situation,
            ...(decided.fact === undefined ? {} : { fact: decided.fact }),
          }
        : {})}
      selection={pinned?.rule === rule && pinned.decided === decided ? pinned.selection : undefined}
      onSelectionChange={onSelectionChange}
    >
      {children}
    </RuleScope>
  )
}
