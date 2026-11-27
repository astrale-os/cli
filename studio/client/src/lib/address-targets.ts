/**
 * What a Schema selection an address names still names in a Domain's bundle. It reads the Rules
 * lens's sites, so it is loaded with the Schema canvas, never with the Studio's first paint.
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { ruleFoldOf, ruleOwnerOf, ruleRowOf, ruleSiteOf } from '@/studio/lenses/rules'
import { policyRuleOf, rulesOf } from '@/studio/rules/model'

/**
 * What a Schema selection names in `bundle`: found, or the nearest thing that is — the Class a
 * member or Method belongs to, the card a rule sits on — or nothing. A ref of a kind this check
 * does not know is taken as found: the canvas lets go of what it cannot draw.
 */
export function resolveSchemaRef(
  bundle: StudioSchemaBundle,
  ref: string,
): { found: true } | { found: false; nearest?: string } {
  const ir = bundle.ir
  if (!ir) return { found: true }
  const exists = (candidate: string): boolean => {
    // a rule as the Schema writes it, a card's fold of several, or a row the map reads alone
    if (candidate.includes('#'))
      return (
        ruleSiteOf(bundle, candidate) !== undefined ||
        ruleFoldOf(bundle, candidate) !== undefined ||
        ruleRowOf(bundle, candidate) !== undefined
      )
    // another Domain's Class, drawn on this canvas as its Schema builds on it
    if (/^class\.[^:]+:class\./.test(candidate)) return true
    const named = /^(class|edge)\.([^.]+)$/.exec(candidate)
    if (named) return ir.classes[named[2]!] !== undefined
    const member = /^class\.([^.]+)\.(method|property)\.([^.]+)$/.exec(candidate)
    if (member) {
      const owner = ir.classes[member[1]!]
      return member[2] === 'method'
        ? owner?.methods[member[3]!] !== undefined
        : owner?.properties[member[3]!] !== undefined
    }
    const method = /^function\.([^.]+)\.([^.]+)$/.exec(candidate)
    if (method) return ir.classes[method[1]!]?.methods[method[2]!] !== undefined
    const fn = /^function\.([^.]+)$/.exec(candidate)
    if (fn) return ir.functions[fn[1]!] !== undefined
    // a Policy as the Rules lens selects it, by its Key — its own or one its rules check — or by its name
    if (candidate.startsWith('policy.')) {
      const rules = rulesOf(bundle)
      if (rules.unread) return true
      const named = candidate.slice('policy.'.length)
      const key = named.includes(':policy.')
        ? named
        : `${rules.origin ?? ir.domain}:policy.${named}`
      return policyRuleOf(rules, key) !== undefined
    }
    if (candidate.startsWith('domain.')) {
      const origin = candidate.slice('domain.'.length)
      return origin === ir.domain || ir.dependencies.some((entry) => entry.origin === origin)
    }
    return true
  }
  if (exists(ref)) return { found: true }
  // the nearest holder: a rule's card, a member's Class, a Method's Class
  const method = /^function\.([^.]+)\.[^.]+$/.exec(ref)
  const holders = [
    ref.includes('#') ? ruleOwnerOf(ref) : undefined,
    /^(class\.[^.]+)\.(?:method|property)\./.exec(ref)?.[1],
    method ? `class.${method[1]}` : undefined,
  ]
  const nearest = holders.find(
    (holder) => holder !== undefined && holder !== ref && !holder.includes('#') && exists(holder),
  )
  return nearest ? { found: false, nearest } : { found: false }
}
