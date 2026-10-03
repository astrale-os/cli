/**
 * Shell issuers that releases before the pin read derived from a managed Instance's route.
 *
 * Those releases wrote, and repaired on every read, `domainIssuer` on the bookmark of an
 * Astrale-managed Instance (`instance use`): `https://shell.beta.astrale.ai` for a
 * `*.beta.astrale.ai` route, else `https://shell.astrale.ai`. It was never the user's choice, and a
 * Shell reinstalled from an immutable deployment no longer answers at it. They wrote the registry
 * without a format label, so only an unlabelled registry can hold such a value. Only these exact
 * values are dropped, and only from a managed bookmark: any other `domainIssuer` is an explicit
 * exact issuer and the canonical resolver honours it.
 */
const ROUTE_DERIVED_SHELL_ISSUERS: ReadonlySet<string> = new Set([
  'https://shell.astrale.ai',
  'https://shell.beta.astrale.ai',
])

/**
 * Read a managed bookmark of a registry an earlier release wrote (no `version`): drop the
 * route-derived Shell issuer, so the bookmark exchanges through the installed Shell whose issuer the
 * Kernel pin names. The caller applies it to managed bookmarks of an unlabelled registry only.
 * Reads never persist the drop; the next bookmark write rewrites the whole registry with
 * `version: 1`, where every `domainIssuer` is explicit and kept, these two values included.
 *
 * @deprecated The installed Shell's issuer is read from the Kernel pin (`schema.inspect` of
 * `shell.astrale.ai`, see `connection/installed-issuer.ts`), and this release labels the registry
 * it writes (`INSTANCE_STORE_VERSION`). Delete, with the unlabelled-registry branch of
 * `sanitizeStore`, once both hold: no supported CLI release writes an unlabelled registry (every
 * release before this one does, since it drops the label it does not know), and no unlabelled
 * registry holding a managed bookmark is read any more, which a breaking release enforces by
 * refusing such a registry or a migration by rewriting it. Both are checkable: the first from the
 * release support window, the second from the registry's own `version`.
 */
export function withoutRouteDerivedShellIssuer<Entry extends { readonly domainIssuer?: string }>(
  entry: Entry,
): Entry {
  if (entry.domainIssuer === undefined || !ROUTE_DERIVED_SHELL_ISSUERS.has(entry.domainIssuer)) {
    return entry
  }
  const { domainIssuer: _routeDerived, ...rest } = entry
  return rest as Entry
}
