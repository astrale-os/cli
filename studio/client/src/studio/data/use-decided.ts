/**
 * Answers decided a slice at a time, so a large dataset never holds the page: each step decides
 * for at most `STEP_MS`, then yields. The answer so far counts what is decided and how much is
 * pending; its readers mark the map only once nothing is. Two answers are decided this way: what
 * an identity may read (`readsSoFar`), and what a Policy admits (`policyPairsSoFar`). Each keeps
 * its own decisions per Access, so a step never decides anything twice.
 */

import { useEffect, useState } from 'react'

import type { PolicyRule } from '../rules/model'

import { type Access, type Reads, readsSoFar } from './access'
import { type PolicyPairs, policyPairsSoFar } from './policy-pairs'

const STEP_MS = 12

function useDecided<Of, Answer extends { readonly pending: number }>(
  access: Access | undefined,
  of: Of | undefined,
  decide: (access: Access, of: Of, budgetMs: number) => Answer,
): Answer | undefined {
  const [state, setState] = useState<{ access: Access; of: Of; answer: Answer }>()
  useEffect(() => {
    if (!access || of === undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const step = () => {
      const answer = decide(access, of, STEP_MS)
      if (stopped) return
      setState({ access, of, answer })
      if (answer.pending > 0) timer = setTimeout(step, 0)
    }
    step()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [access, decide, of])
  return state && state.access === access && state.of === of ? state.answer : undefined
}

/** What an identity may read of the dataset, decided so far. */
export function useReads(
  access: Access | undefined,
  identity: string | undefined,
): Reads | undefined {
  return useDecided(access, identity, readsSoFar)
}

/** What a Policy admits on the dataset, decided so far. */
export function usePolicyPairs(
  access: Access | undefined,
  policy: PolicyRule | undefined,
): PolicyPairs | undefined {
  return useDecided(access, policy, policyPairsSoFar)
}
