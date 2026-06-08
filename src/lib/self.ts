/**
 * `@self` shorthand: expands to the nodeId behind the JWT `sub` claim that
 * the current CLI invocation would ship. Pure helpers — no I/O.
 *
 * Kernel-side, `Identity::registerIdentity` writes `sub = String(self.id)`
 * (kernel/runtime/syscalls/identity/index.ts), so for any properly-registered
 * identity the JWT `sub` IS the calling node's id on the target kernel.
 * Delegation tokens follow the same shape (outer-envelope `sub` = identityId).
 *
 * The expansion is fail-loud: when no `sub` is resolvable, return a typed
 * refusal carrying the exact next-step command. Never silently fall back to
 * a label-ish `identity.subject` like "manager" or "alice".
 */
import { decodeJwt } from 'jose'

import type { Identity } from './identity'

/** Inputs to `resolveSelfNodeId`. All local — no kernel round-trip. */
export type SelfResolverContext = {
  /** Identity that will sign this call (default identity or the one from `--as`). */
  identity?: Identity & { name: string }
  /** Resolved instance slug, if any (absent when `--url` is used without `-i`). */
  instanceSlug?: string
  /** Raw `--creds` JWT, if the user provided one. */
  credsJwt?: string
  /** True when `auth.ts` will sign as the instance itself (per-instance keypair, not user identity). */
  instanceSigned: boolean
  /** `sub` decoded from a cached IdP token for source=idp identities, when available. */
  idpSubject?: string
}

export type SelfRefusal =
  | { reason: 'manager' }
  | { reason: 'no-registration'; identityName: string; instanceSlug: string }
  | { reason: 'instance-signed'; instanceSlug: string }
  | { reason: 'url-no-slug' }
  | { reason: 'creds-no-sub' }
  | { reason: 'idp-no-sub'; identityName: string }

export type SelfResolution = { id: string } | SelfRefusal

// Anchors:
//   left:  start-of-string OR right after `=` (param-value head)
//   right: end-of-string OR `::` (instance method) OR `/` (path navigation)
// The `/` lookahead is required so `@self/functions` etc. expand — the
// `astrale ls @self/functions` form is documented in SKILL.md and the
// sandbox prefix. Without it the regex silently no-ops on those inputs.
const SELF_RE = /(?:^|(?<=[=]))@self(?=$|::|\/)/g

/** Resolve `@self` → `{ id: <nodeId> }`, or a typed refusal. */
export function resolveSelfNodeId(ctx: SelfResolverContext): SelfResolution {
  // 1. `--creds <jwt>` — bypasses every identity lookup. Read the sub claim.
  if (ctx.credsJwt) {
    try {
      const sub = decodeJwt(ctx.credsJwt).sub
      // `.trim().length` rejects whitespace-only subs (`'   '`, `'\t'`).
      // A hand-crafted JWT with `sub: '   '` previously round-tripped into
      // `@   ::method`, producing a malformed kernel call instead of the
      // typed `creds-no-sub` refusal.
      if (typeof sub === 'string' && sub.trim().length > 0) return { id: sub }
    } catch {
      // fall through to creds-no-sub
    }
    return { reason: 'creds-no-sub' }
  }
  // 2. Instance-signed: no user identity context — `@self` is undefined.
  if (ctx.instanceSigned) {
    return { reason: 'instance-signed', instanceSlug: ctx.instanceSlug ?? 'unknown' }
  }
  // 3. IdP-backed identities ship the provider access token directly. There
  // is no local registration cache to consult; when the token has a usable
  // subject, expand `@self` to that subject.
  if ((ctx.identity?.source ?? 'key') === 'idp') {
    if (ctx.idpSubject) return { id: ctx.idpSubject }
    return { reason: 'idp-no-sub', identityName: ctx.identity?.name ?? '(unknown)' }
  }
  // 4. `--url` without `-i`: no slug to look up registration against.
  if (!ctx.instanceSlug) return { reason: 'url-no-slug' }
  // 5. Bootstrap `manager` identity has no graph node by construction.
  if (
    ctx.identity?.name === 'manager' &&
    (!ctx.identity.registrations || Object.keys(ctx.identity.registrations).length === 0)
  ) {
    return { reason: 'manager' }
  }
  // 6. Default path: read the registration entry for the resolved slug.
  // `sub` IS the node id by construction for entries written by
  // `registerIdentity` (kernel/runtime/syscalls/identity/index.ts:207).
  const id = ctx.identity?.registrations?.[ctx.instanceSlug]?.sub
  if (!id) {
    return {
      reason: 'no-registration',
      identityName: ctx.identity?.name ?? '(unknown)',
      instanceSlug: ctx.instanceSlug,
    }
  }
  return { id }
}

/** Cheap pre-check before invoking the resolver — skip when no `@self` appears. */
export function containsSelfRef(input: string): boolean {
  SELF_RE.lastIndex = 0
  return SELF_RE.test(input)
}

/**
 * Replace every `@self` token (path head or `=@self`) with `@<selfId>`.
 *
 * Uses the function-form replacement so a `selfId` containing `$&`, `$$`,
 * `$<n>`, etc. is not interpreted as a `String.replace` substitution
 * pattern. A delegation-token `sub` claim or future opaque kernel id can
 * legitimately carry `$`.
 */
export function expandSelfReferences(input: string, selfId: string): string {
  const replacement = `@${selfId}`
  return input.replace(SELF_RE, () => replacement)
}

/** Build a human-facing error carrying the typed refusal as metadata. */
export function selfRefusalError(r: SelfRefusal): Error {
  const e = new Error(refusalMessage(r))
  e.name = 'SelfRefusalError'
  ;(e as Error & { selfRefusal: SelfRefusal }).selfRefusal = r
  return e
}

function refusalMessage(r: SelfRefusal): string {
  switch (r.reason) {
    case 'manager':
      return [
        "`@self` not available: you're signed in as the bootstrap `manager` identity, which has no graph node.",
        'Run `astrale identity create <name>` then `astrale identity register <name>` to enable `@self`.',
      ].join('\n  ')
    case 'no-registration':
      return [
        `\`@self\` not available: identity "${r.identityName}" has no registration on instance "${r.instanceSlug}".`,
        `Run \`astrale identity register ${r.identityName} -i ${r.instanceSlug}\`.`,
      ].join('\n  ')
    case 'instance-signed':
      return [
        `\`@self\` not available: this call signs as instance "${r.instanceSlug}" itself, not a user identity.`,
        'Use `--as <name>` to sign as a registered identity, or pass a literal `@<nodeId>`.',
      ].join('\n  ')
    case 'url-no-slug':
      return [
        '`@self` needs an instance slug to look up the registration.',
        'Add `-i <slug>`, or if this URL maps to a bookmark, use that slug instead of `--url`.',
      ].join('\n  ')
    case 'creds-no-sub':
      return [
        '`@self` not available: the `--creds` JWT has no usable `sub` claim.',
        'Pass a literal `@<nodeId>` instead.',
      ].join('\n  ')
    case 'idp-no-sub':
      return [
        `\`@self\` not available: IdP identity "${r.identityName}" has no cached token with a usable \`sub\` claim.`,
        `Run \`astrale auth login --name ${r.identityName}\` again, or pass a literal \`@<nodeId>\`.`,
      ].join('\n  ')
  }
}
