/**
 * A verdict as the panel reads it: allowed, refused or can't tell; the operation it decides and
 * whom the rule there admits, as the Schema marks both; by which rule, in words; why; and what it
 * lights on the map. Pure, so each outcome reads the same wherever it is shown.
 */

import type { SceneRuleMark } from '../scene/types'
import type { PathStep, Slot, Verdict } from './access'

import { markOf } from '../rules/admission'

export interface VerdictView {
  readonly id: string
  readonly outcome: Verdict['outcome']
  /** the operation it decides, whose glyph and hue it wears */
  readonly op: Slot
  /** whom the rule where it is decided admits, as the Schema marks it; none where no rule is read */
  readonly admits?: SceneRuleMark
  readonly sentence: string
  /** what decides it, as a noun phrase: `Policy OwnService`, `the Kernel's default` */
  readonly by: string
  /** the Policies that decide it, each as a selection the Schema level opens (`policy.<key>`) */
  readonly policies: readonly { readonly name: string; readonly target?: string }[]
  readonly why: string
  /** the Edges that prove an allowed verdict, each with its words */
  readonly path: readonly PathStep[]
  /** the Node paths and Edge ids the map lights for it */
  readonly lights: { readonly nodes: readonly string[]; readonly edges: readonly string[] }
}

/** A Policy's Kernel Key, shortened to its name, and opened at the Schema level when it is the Domain's own. */
function policyOf(key: string, origin: string): { name: string; target?: string } {
  const at = key.indexOf(':policy.')
  if (at < 0) return { name: key }
  const name = key.slice(at + ':policy.'.length)
  return key.slice(0, at) === origin
    ? { name, target: `policy.${key}` }
    : { name: `${name} (${key.slice(0, at)})` }
}

export function verdictView(verdict: Verdict, origin: string): VerdictView {
  const by = verdict.by
  const admits =
    by.kind === 'contract' ? markOf(undefined, by.auth) : by.site ? markOf(by.site) : undefined
  const policies = by.kind === 'rule' ? by.policies.map((key) => policyOf(key, origin)) : []
  const decider =
    by.kind === 'rule'
      ? policies.length === 1
        ? `Policy ${policies[0]!.name}`
        : policies.length > 1
          ? `Policies ${policies.map((policy) => policy.name).join(', ')}`
          : `the rule written on ${by.site.slot}`
      : by.kind === 'kernel'
        ? "the Kernel's default"
        : by.kind === 'true'
          ? 'a rule written true'
          : by.kind === 'declarer'
            ? 'the Domain that declares it'
            : by.kind === 'contract'
              ? `its contract (${by.auth})`
              : 'no rule the reader can decide'
  return {
    id: verdict.id,
    outcome: verdict.outcome,
    op: verdict.slot,
    ...(admits === undefined ? {} : { admits }),
    sentence: verdict.sentence,
    by: decider,
    policies,
    why: verdict.why,
    path: verdict.path,
    lights: verdict.proof,
  }
}
