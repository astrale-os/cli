/**
 * The selection across lenses. A selection is one thing whichever lens draws it — a Class
 * selected in Structure is the same `class.X` in Behavior — so switching lens keeps it.
 * Where the lens does not draw it, what stands for it there lights instead, never nothing:
 *
 * - a function: the Classes and relationships it writes, else the Class it is declared on,
 *   else its module;
 * - a mutation: what it writes, else the Classes of the functions that use it;
 * - an Integration: the Classes whose Methods reach it, else their modules;
 * - a Class: its Methods; a relationship, also the functions that write it and where they
 *   write it; else its module.
 *
 * On a map of rules, a function stands on its call rule; a Policy, on the places it sits; a
 * form of constraint, on its sites. Elsewhere a rule stands on what it sits on — a Method's
 * call rule on the Method, a Class's rule on the Class —, a Policy and a form of constraint
 * on what their sites sit on, the Domain functions card on those functions.
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'

import type { Scene } from '../scene/types'

import { moduleOfMember } from '../../schema-studio/modules'
import { rulesOf } from '../rules/model'
import { rulePlaces } from '../scene/rules'
import { behaviorModel, type BehaviorModel, type FunctionModel } from './behavior'
import { constraintSites, DOMAIN_FUNCTIONS, policySites } from './rules'

const NONE: readonly string[] = []

/** The nodes and relationships a function's mutations write, by selection id. */
function writtenBy(model: BehaviorModel, fn: FunctionModel): string[] {
  return fn.mutations.flatMap(
    (id) =>
      model.mutations
        .get(id)
        ?.changes.flatMap((change) => [...change.nodes, ...change.relationships]) ?? [],
  )
}

const ownerOf = (fn: FunctionModel) => (fn.owner ? `class.${fn.owner}` : fn.id)

/** What stands for `selected` in `scene` when the scene does not draw it; nothing when it does. */
export function standIns(
  bundle: StudioSchemaBundle,
  scene: Scene,
  selected: string | undefined,
): readonly string[] {
  if (!selected || !bundle.ir) return NONE
  const drawn = new Set([
    ...scene.nodes.map((node) => node.id),
    ...scene.links.map((link) => link.id),
    ...scene.groups.map((group) => group.id),
  ])
  if (drawn.has(selected)) return NONE
  const within = (ids: Iterable<string>) => [...new Set(ids)].filter((id) => drawn.has(id)).sort()
  const first = (...candidates: string[][]) =>
    candidates.find((candidate) => candidate.length > 0) ?? NONE

  const places = rulePlaces(scene)
  if (places.size > 0) {
    if (places.has(selected)) return NONE
    const placed = (ids: Iterable<string>) =>
      [...new Set(ids)].filter((id) => places.has(id)).sort()
    const method = /^function\.([^.]+)\.([^.]+)$/.exec(selected)
    if (method) {
      const call = placed([`class.${method[1]}.method.${method[2]}#call`])
      if (call.length > 0) return call
    } else if (selected.startsWith('function.')) {
      const call = placed([`${selected}#call`])
      if (call.length > 0) return call
    }
    if (selected.startsWith('policy.')) return placed(policySites(rulesOf(bundle), selected))
    if (selected.startsWith('constraint.'))
      return placed(constraintSites(rulesOf(bundle), selected).map((site) => site.id))
  } else {
    const sitsOn = (id: string): string[] => {
      if (id.endsWith('#call')) {
        const method = /^class\.([^.]+)\.method\.([^.]+)#call$/.exec(id)
        return [method ? `function.${method[1]}.${method[2]}` : id.slice(0, -'#call'.length)]
      }
      return [id.replace(/#.*$/, '')]
    }
    const standing = (ids: string[]) =>
      first(within(ids), within(ids.flatMap((id) => [...standIns(bundle, scene, id)])))
    if (selected.includes('#')) return standing(sitsOn(selected))
    if (selected.startsWith('policy.'))
      return standing(policySites(rulesOf(bundle), selected).flatMap(sitsOn))
    if (selected.startsWith('constraint.'))
      return standing(constraintSites(rulesOf(bundle), selected).map((site) => site.on.target))
    if (selected === DOMAIN_FUNCTIONS)
      return standing(Object.keys(bundle.ir.functions).map((name) => `function.${name}`))
  }

  const model = behaviorModel(bundle)

  if (selected.startsWith('function.')) {
    const fn = model.functions.find((candidate) => candidate.id === selected)
    if (!fn) return NONE
    return first(
      within(writtenBy(model, fn)),
      within(fn.owner ? [ownerOf(fn)] : []),
      within([`module.${fn.module}`]),
    )
  }
  if (selected.startsWith('mutation.')) {
    const mutation = model.mutations.get(selected)
    if (!mutation) return NONE
    return first(
      within(mutation.changes.flatMap((change) => [...change.nodes, ...change.relationships])),
      within(model.functions.filter((fn) => fn.mutations.includes(selected)).map(ownerOf)),
    )
  }
  if (selected.startsWith('integration.')) {
    const key = selected.slice('integration.'.length)
    const callers = model.functions.filter((fn) =>
      fn.calls.some((call) => call.startsWith(`${key}.`)),
    )
    return first(within(callers.map(ownerOf)), within(callers.map((fn) => `module.${fn.module}`)))
  }
  if (selected.startsWith('class.')) {
    const methods = model.functions.filter((fn) => fn.owner && ownerOf(fn) === selected)
    const writes = model.functions.flatMap((fn) =>
      fn.mutations.flatMap((id) =>
        (model.mutations.get(id)?.changes ?? [])
          .filter((change) => change.relationships.includes(selected))
          .map((change) => ({ fn: fn.id, nodes: change.nodes })),
      ),
    )
    const name = selected.slice('class.'.length)
    const member = bundle.ir.classes[name]
    const module = member
      ? `module.${moduleOfMember(bundle, member.type === 'edge' ? 'edge' : 'class', name)}`
      : undefined
    return first(
      within([
        ...methods.map((fn) => fn.id),
        ...writes.flatMap((write) => [write.fn, ...write.nodes]),
      ]),
      within(module ? [module] : []),
    )
  }
  return NONE
}

/**
 * What lights for `ids` in `scene`: each one itself where the scene draws it, else what
 * stands for it there. Sorted and without repeats, so equal spotlights compare equal.
 */
export function spotlit(
  bundle: StudioSchemaBundle,
  scene: Scene,
  ids: readonly string[],
): readonly string[] {
  const drawn = new Set([
    ...scene.nodes.map((node) => node.id),
    ...scene.links.map((link) => link.id),
    ...scene.groups.map((group) => group.id),
  ])
  const lit = ids.flatMap((id) => (drawn.has(id) ? [id] : standIns(bundle, scene, id)))
  return [...new Set(lit)].sort()
}
