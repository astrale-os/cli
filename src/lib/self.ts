/**
 * Lexical `@self` helpers. Effective-principal resolution is deliberately not
 * local: connection/self.ts asks the authenticated target Kernel through
 * Identity.whoami before replacing any reference.
 */

// Anchors:
//   left:  start-of-string OR right after `=` (param-value head)
//   right: end-of-string OR `::` (instance method) OR `/` (path navigation)
const SELF_RE = /(?:^|(?<=[=]))@self(?=$|::|\/)/g

/** Cheap pre-check before invoking authenticated principal resolution. */
export function containsSelfRef(input: string): boolean {
  SELF_RE.lastIndex = 0
  return SELF_RE.test(input)
}

/** Replace every admitted `@self` token with one authenticated NodeId. */
export function expandSelfReferences(input: string, selfId: string): string {
  const replacement = `@${selfId}`
  return input.replace(SELF_RE, () => replacement)
}
