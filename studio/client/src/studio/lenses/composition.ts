/**
 * What the Structure canvas can draw of the Domains around the open one, and how a selection
 * reads across them. Pure: every function reads only what it is given.
 *
 * - The Domains offered are every other Domain of the Workspace, then every Domain outside it the
 *   open Domain depends on or reaches, each in the order of its name.
 * - A Domain is offered whole only when its own Schema can be read: a Workspace Domain, or one
 *   outside it the Studio holds (the Kernel). The Classes the open Domain imports never stand in
 *   for a whole Domain.
 * - The Domains drawn whole are drawn in the order they are offered, after the open one.
 * - A selection belongs to the open Domain's canvas. One only a Domain drawn whole declares is
 *   read on that Domain's own page; every lens but Structure reads the open Domain alone, so it
 *   lets such a selection go (`namedOnlyBeside`).
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'
import type { DomainShare } from '@shared/contracts/workspace'

import { classRefKey, type IrClassRef, parseClassRefKey } from '@shared/schema/identity'

import type { DomainChoice, DrawnAs } from '../canvas/domains-control'

import { domainName } from '../workspace/words'
import { classTarget } from './structure'

/** The Domains whose own Schema the Studio can read, by origin: each one's Domain id. */
export interface ReadableDomains {
  /** the Workspace's Domains */
  readonly workspace: ReadonlyMap<string, string>
  /** Domains outside the Workspace the Studio holds a Schema of (the Kernel) */
  readonly outside: ReadonlyMap<string, string>
}

/** Every origin other than its own that the open Domain depends on or reaches. */
function originsAround(bundle: StudioSchemaBundle): Set<string> {
  const origins = reachedOrigins(bundle)
  for (const dependency of bundle.ir?.dependencies ?? []) origins.add(dependency.origin)
  if (bundle.ir) origins.delete(bundle.ir.domain)
  return origins
}

/** The origins of the Domains the open Domain's Classes reach: drawn when reached. */
export function reachedOrigins(bundle: StudioSchemaBundle): Set<string> {
  const ir = bundle.ir
  const origins = new Set<string>()
  if (!ir) return origins
  for (const imported of Object.values(ir.importsByKey)) origins.add(imported.origin)
  origins.delete(ir.domain)
  return origins
}

const byLabel = (left: DomainChoice, right: DomainChoice) =>
  left.label.localeCompare(right.label) || left.origin.localeCompare(right.origin)

/**
 * Each other Domain the open one's Structure can draw, and how it draws it now. `read` holds the
 * origins whose whole Schema has been read; `failed`, those whose Schema could not be.
 */
export function domainChoices(
  bundle: StudioSchemaBundle,
  readable: ReadableDomains,
  shares: Readonly<Record<string, DomainShare>>,
  read: ReadonlySet<string>,
  failed: ReadonlySet<string> = new Set(),
): DomainChoice[] {
  const home = bundle.ir?.domain
  if (home === undefined) return []
  const homeLabel = domainName(home)
  const choice = (origin: string, place: DomainChoice['place']): DomainChoice => {
    const canWhole = readable.workspace.has(origin) || readable.outside.has(origin)
    const asked: DrawnAs = shares[origin] ?? 'reached'
    const drawn: DrawnAs = asked === 'whole' && !canWhole ? 'reached' : asked
    return {
      origin,
      label: domainName(origin),
      place,
      drawn,
      ...(canWhole
        ? {}
        : {
            noWhole: `Only the Classes ${homeLabel} reaches are known here: the Studio cannot read its own Schema.`,
          }),
      ...(drawn === 'whole' && failed.has(origin)
        ? { note: 'Its Schema could not be read: it is drawn as reached meanwhile.' }
        : drawn === 'whole' && !read.has(origin)
          ? { reading: true }
          : {}),
    }
  }
  const inside = [...readable.workspace.keys()]
    .filter((origin) => origin !== home)
    .map((origin) => choice(origin, 'workspace'))
    .sort(byLabel)
  const outside = [...originsAround(bundle)]
    .filter((origin) => !readable.workspace.has(origin))
    .map((origin) => choice(origin, 'outside'))
    .sort(byLabel)
  return [...inside, ...outside]
}

/** The Domain ids to read whole, in the order their areas are drawn. */
export function wholeDomainIds(
  choices: readonly DomainChoice[],
  readable: ReadableDomains,
): string[] {
  return choices.flatMap((choice) => {
    if (choice.drawn !== 'whole') return []
    const id = readable.workspace.get(choice.origin) ?? readable.outside.get(choice.origin)
    return id === undefined ? [] : [id]
  })
}

/** Whether drawing `origin` as `next` instead of `previous` changes what the canvas draws. */
export function redraws(
  bundle: StudioSchemaBundle,
  origin: string,
  previous: DrawnAs,
  next: DrawnAs,
): boolean {
  if (previous === next) return false
  if (previous === 'whole' || next === 'whole') return true
  return reachedOrigins(bundle).has(origin)
}

/**
 * Whether a selection names what only a Domain drawn beside the open one declares: a Class or
 * relationship of another Domain the open Domain does not import, or one of its modules. The open
 * Domain's own Schema names nothing for it.
 */
export function namedOnlyBeside(bundle: StudioSchemaBundle, selection: string): boolean {
  const ir = bundle.ir
  if (!ir) return false
  if (selection.startsWith('module.')) {
    const at = selection.lastIndexOf('@')
    const origin = at < 0 ? undefined : selection.slice(at + 1)
    return origin !== undefined && origin.includes('.') && origin !== ir.domain
  }
  const ref = classRefOf(selection)
  if (!ref || ref.origin === ir.domain) return false
  return ir.importedClassesByKey[classRefKey(ref)] === undefined
}

/** The Class or relationship a `class.<key>` / `edge.<key>` selection names, by its exact key. */
function classRefOf(selection: string): IrClassRef | undefined {
  const kind = selection.startsWith('class.')
    ? 'class.'
    : selection.startsWith('edge.')
      ? 'edge.'
      : undefined
  return kind === undefined ? undefined : parseClassRefKey(selection.slice(kind.length))
}

/**
 * The canvas id of what Domain `from` names `target` (`class.X`, `edge.X`, `class.<key>`), on
 * the canvas of `home`: a Class keeps one id on it whichever Domain names it. A target that names
 * no Class has none.
 */
export function canvasIdOf(target: string, from: string, home: string): string | undefined {
  const exact = classRefOf(target)
  if (exact) return classTarget(exact, home)
  const name = target.startsWith('class.')
    ? target.slice('class.'.length)
    : target.startsWith('edge.')
      ? target.slice('edge.'.length)
      : undefined
  if (name === undefined || !/^[^.:]+$/.test(name)) return undefined
  return classTarget({ origin: from, kind: 'class', name }, home)
}
