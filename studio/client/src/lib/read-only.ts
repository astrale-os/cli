import { domainAddressOf } from '@shared/contracts/workspace'

/**
 * The one rule for the Domains the Studio only reads: the Kernel and every Publication
 * (`domainAddressOf`, as `isReadOnlyDomainId` reads it). A surface that would write to a Domain asks it, and says in place what
 * that Domain takes there, in its own words. The server's routes refuse the same writes; this
 * rule keeps the Studio from offering them.
 */

/** What is done to a Domain's element from a target: a comment filed on it, or an Ask about it. */
export type TargetAct = 'comment' | 'ask'

/** Why `act` is bounded on a read-only Domain; undefined on a Domain of the Workspace. */
export function readOnlyNotice(domainId: string, act: TargetAct): string | undefined {
  const { kind } = domainAddressOf(domainId)
  if (kind !== 'kernel' && kind !== 'publication') return undefined
  const kernel = kind === 'kernel'
  if (act === 'ask')
    return `${kernel ? 'The Kernel' : 'A Publication'} is read-only: Ask answers from its Schema and changes no file.`
  return kernel
    ? 'The Kernel is read-only: comment on your own Domains, or Ask (A) about it.'
    : 'A Publication is read-only: there is no thread to start on it. Ask (A) about it instead.'
}
