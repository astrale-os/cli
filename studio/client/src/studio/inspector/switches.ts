/**
 * The other questions about a selection, each with what makes it worth asking: how much the
 * other lens has to say. A lens with nothing to say about the selection is not offered.
 */
import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { classRefKey } from '@shared/schema/identity'

import type { LensId, LensKey } from '../lenses/keys'
import type { InspectorTarget } from './target'

import { contractAdmits } from '../rules/admission'
import { callRuleOf, type DomainRules, sitesOn } from '../rules/model'
import { behaviorOf, changersOf, mayChangersOf } from './behavior'
import { structureOf } from './structure'
import { articleOf, NO_TERMS, opening, type Terms, withArticle } from './words'

export interface LensSwitch {
  readonly lens: LensKey
  /** `7 functions write a Host` */
  readonly text: string
}

const plural = (count: number, one: string, other = `${one}s`) =>
  `${count} ${count === 1 ? one : other}`

/** What each lens other than `lens` would answer about the target, in lens order. */
export function switchesOf(
  bundle: StudioSchemaBundle,
  target: InspectorTarget,
  rules: DomainRules,
  lens: LensId,
  terms: Terms = NO_TERMS,
): LensSwitch[] {
  const asked: Record<LensKey, () => string | undefined> = {
    structure: () => structureWords(bundle, target, terms),
    behavior: () => behaviorWords(bundle, target, terms),
    rules: () => rulesWords(bundle, target, rules, terms),
  }
  return (['structure', 'behavior', 'rules'] as const).flatMap((each) => {
    if (each === lens) return []
    const text = asked[each]()
    return text === undefined ? [] : [{ lens: each, text }]
  })
}

/** `a Host`, `an Issue`: the Class with its article. */
function some(target: Extract<InspectorTarget, { kind: 'class' }>, terms: Terms) {
  const name = target.ref.name
  return `${articleOf(name, terms.noun(classRefKey(target.ref))).toLowerCase()} ${name}`
}

function structureWords(bundle: StudioSchemaBundle, target: InspectorTarget, terms: Terms) {
  if (target.kind !== 'class') return undefined
  const structure = structureOf(bundle, target.ref, terms)
  if (structure === undefined) return undefined
  const count = structure.properties.length
  const properties = count === 0 ? 'no properties' : plural(count, 'property', 'properties')
  if (structure.kind === 'relationship') {
    const [from, to] = structure.ends
    const names = (end: typeof from) => end.accepts.map((each) => each.name).join(' or ')
    return `It links ${names(from)} to ${names(to)}${count === 0 ? '' : `, with ${properties}`}`
  }
  const relationships = structure.relationships.length
  return `${opening(some(target, terms))} has ${properties} and ${relationships === 0 ? 'no relationships' : plural(relationships, 'relationship')}`
}

function behaviorWords(bundle: StudioSchemaBundle, target: InspectorTarget, terms: Terms) {
  const behavior = behaviorOf(bundle, target, terms)
  if (behavior === undefined) return undefined
  switch (behavior.kind) {
    case 'class': {
      const changers = changersOf(behavior)
      const what = behavior.relationship
        ? `${target.kind === 'class' ? target.ref.name : behavior.name} links`
        : some(target as Extract<InspectorTarget, { kind: 'class' }>, terms)
      if (changers > 0)
        return `${plural(changers, 'function')} ${changers === 1 ? 'writes' : 'write'} ${what}`
      const may = mayChangersOf(behavior)
      if (may > 0)
        return `${plural(may, 'function')} may write ${what} through a base or a shared end`
      if (behavior.readers.length > 0)
        return `${plural(behavior.readers.length, 'function')} ${behavior.readers.length === 1 ? 'reads' : 'read'} ${what}; none writes it`
      return undefined
    }
    case 'function': {
      const parts = [
        ...(behavior.changes.length > 0
          ? [`uses ${plural(behavior.changes.length, 'mutation')}`]
          : []),
        ...(behavior.reaches.length > 0
          ? [`reaches ${plural(behavior.reaches.length, 'operation')} outside`]
          : []),
        ...(behavior.calls.length > 0
          ? [`calls ${plural(behavior.calls.length, 'function')}`]
          : []),
      ]
      if (parts.length === 0) return behavior.input.length > 0 ? `Its input and output` : undefined
      const sentence =
        parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
      return `It ${sentence}`
    }
    case 'definition': {
      const stated = behavior.preconditions.length
      return [
        plural(behavior.effects.length, 'effect'),
        ...(stated > 0 ? [plural(stated, 'precondition')] : []),
        `used by ${plural(behavior.usedBy.length, 'function')}`,
      ].join(', ')
    }
    case 'integration':
      return `${plural(behavior.operations.length, 'operation')}, reached by ${plural(new Set(behavior.operations.flatMap((each) => each.users.map((user) => user.key))).size, 'function')}`
  }
}

function rulesWords(
  bundle: StudioSchemaBundle,
  target: InspectorTarget,
  rules: DomainRules,
  terms: Terms,
) {
  if (rules.unread !== undefined) return undefined
  if (target.kind === 'class') {
    const sites = sitesOn(rules, target.id)
    if (sites.length === 0) return undefined
    const who = sites.filter((site) => site.kind === 'who' && site.written === 'rule').length
    const what = sites.filter((site) => site.kind === 'what').length
    const subject =
      target.cls.type === 'edge' ? withArticle(`${target.ref.name} link`) : some(target, terms)
    if (who === 0 && what === 0)
      return `No rule is written on ${subject}: the Kernel’s defaults apply`
    // one written rule per slot: read and traverse may be written with the same Policies
    const parts = [
      ...(who > 0
        ? [`${plural(who, 'written rule')} decide${who === 1 ? 's' : ''} who may act on ${subject}`]
        : []),
      ...(what > 0 ? [plural(what, 'constraint')] : []),
    ]
    return parts.join('; ')
  }
  if (target.kind === 'function') {
    const site = callRuleOf(rules, ruleTargetOf(target), target.callable.auth, target.abstract)
    const { auth } = target.callable
    if (auth === 'anonymous' || auth === 'authenticated') return contractAdmits(auth)
    if (site === undefined) return undefined
    return site.written === 'rule'
      ? 'A written rule decides who may call it'
      : 'No Policy is written on it'
  }
  if (target.kind === 'definition' || target.kind === 'integration') {
    const behavior = behaviorOf(bundle, target, terms)
    const users =
      behavior?.kind === 'definition'
        ? behavior.usedBy.length
        : behavior?.kind === 'integration'
          ? new Set(behavior.operations.flatMap((each) => each.users.map((user) => user.key))).size
          : 0
    if (users === 0) return undefined
    return `The call ${users === 1 ? 'rule' : 'rules'} of ${plural(users, 'function')} guard${users === 1 ? 's' : ''} it`
  }
  return undefined
}

/** The selection id rules key a callable by: `class.X.method.m`, `function.f`. */
export function ruleTargetOf(target: Extract<InspectorTarget, { kind: 'function' }>): string {
  return target.owner === undefined ? target.id : `class.${target.owner}.method.${target.name}`
}
