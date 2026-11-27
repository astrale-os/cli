/**
 * The stamp that makes a drawn part a comment target. Only a ref a comment can be filed under
 * is stamped (`concreteAnchorKind`): a part that stands for nothing of the Domain — a stand-in,
 * a gathering, a Scenario — is no target, so a click on it resolves to the scope around it.
 */

import { concreteAnchorKind } from '@shared/comment-anchors'

import { anchorData } from '@/lib/targets'

export function commentTarget(ref: string | undefined, excerpt: string, domainId?: string) {
  return ref !== undefined && concreteAnchorKind(ref) !== undefined
    ? anchorData(ref, excerpt, domainId)
    : {}
}
