/**
 * Whom a rule admits, as one mark says it wherever the rule is read — a card's row, the Index,
 * the Inspector: what the Schema writes (a Policy, `true`, `false`), what the Kernel's default
 * admits where it writes nothing, or what a callable's contract opens it to.
 *
 * The Kernel's defaults (`kernelDefaultOf` says them in full): reading or traversing an
 * unwritten slot is open to every caller; creating, updating or deleting is left to Root, the
 * declaring Domain and holders of that operation's capability; a callable with no call rule,
 * or `false` anywhere, to Root and the declaring Domain alone. A callable whose contract admits
 * anonymous callers is open to every caller; one that admits any authenticated caller, or whose
 * call rule is `true`, to any signed-in caller.
 */

import type { RuleAdmission, RuleOp, SceneRuleMark } from '../scene/types'
import type { RuleSite } from './model'

const OPS: ReadonlySet<string> = new Set<RuleOp>([
  'read',
  'traverse',
  'create',
  'update',
  'delete',
  'call',
])

/** The operation a slot decides; none for a constraint or a slot no operation names. */
export function opOf(slot: string): RuleOp | undefined {
  return OPS.has(slot) ? (slot as RuleOp) : undefined
}

/** A callable's contract: who it admits before any call rule is read. */
export type CallAuth = 'anonymous' | 'authenticated' | 'authorized'

/**
 * The mark of a site, or of a callable no call rule decides (`site` undefined, `auth` its
 * contract): none for a constraint.
 */
export function markOf(site: RuleSite | undefined, auth?: CallAuth): SceneRuleMark | undefined {
  if (!site) return { op: 'call', admits: auth === 'anonymous' ? 'open' : 'signed-in' }
  const op = opOf(site.slot)
  if (!op || site.kind !== 'who') return undefined
  switch (site.written) {
    case 'rule':
      return { op, admits: 'policy' }
    case 'true':
      return { op, admits: op === 'call' ? 'signed-in' : 'open' }
    case 'false':
      return { op, admits: 'closed' }
    case 'omitted':
    case 'absent':
      // A callable whose rules the reader has no use for is another Domain's, or each
      // implementation's: nothing here says whom it admits.
      if (site.reading.status === 'unread' && op === 'call')
        return { op, admits: 'unread', unwritten: true }
      return { op, admits: kernelAdmits(op), unwritten: true }
    default:
      return undefined
  }
}

/** Whom the Kernel admits where nothing is written. */
function kernelAdmits(op: RuleOp): RuleAdmission {
  if (op === 'read' || op === 'traverse') return 'open'
  if (op === 'call') return 'closed'
  return 'holders'
}

/**
 * Whom a mark says a rule admits, in a few words: what its title and label read. Where only the
 * Domain that owns the Class or callable may act, the words say that alone: Root, and for a
 * write the holders of its capability, are `kernelDefaultOf`'s to add on hover.
 */
export const ADMITS: Record<RuleAdmission, string> = {
  policy: 'a Policy decides',
  open: 'everyone',
  'signed-in': 'anyone signed in',
  holders: 'owning Domain only',
  closed: 'owning Domain only',
  unread: 'not read here',
}

/** Whom an admission admits, as the label beside its mark reads: `Owning Domain only`. */
export const admissionLabel = (admits: RuleAdmission) =>
  ADMITS[admits].charAt(0).toUpperCase() + ADMITS[admits].slice(1)

/**
 * What a callable's contract admits, in words, whom as its mark says: `anonymous` opens it to
 * everyone, `authenticated` to anyone signed in.
 */
export const contractAdmits = (auth: Exclude<CallAuth, 'authorized'>) =>
  `Its contract admits ${ADMITS[auth === 'anonymous' ? 'open' : 'signed-in']}`

/** The same where no call rule decides the callable, and so why. */
export const contractWords = (auth?: CallAuth) =>
  `${contractAdmits(auth === 'anonymous' ? 'anonymous' : 'authenticated')}: no call rule applies.`

/** Whom a mark admits, in words: `a Policy decides`, `everyone, nothing written`. */
export function markAdmits(mark: SceneRuleMark): string {
  return `${ADMITS[mark.admits]}${mark.unwritten && mark.admits !== 'unread' ? ', nothing written' : ''}`
}

/** A mark said in words: `read · a Policy decides`, `create · owning Domain only, nothing written`. */
export function markWords(mark: SceneRuleMark): string {
  return `${mark.op} · ${markAdmits(mark)}`
}

/** The marks of several rules, each different one once, in the order they come. */
export function distinctMarks(marks: readonly (SceneRuleMark | undefined)[]): SceneRuleMark[] {
  const seen = new Map<string, SceneRuleMark>()
  for (const mark of marks) {
    if (!mark) continue
    const key = `${mark.op}|${mark.admits}|${mark.unwritten === true}`
    if (!seen.has(key)) seen.set(key, mark)
  }
  return [...seen.values()]
}
