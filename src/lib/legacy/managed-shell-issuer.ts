/**
 * Shell issuers that releases before the pin read derived from a managed Instance's route.
 *
 * Those releases wrote, and repaired on every read, `domainIssuer` on the bookmark of an
 * Astrale-managed Instance (`instance use`): `https://shell.beta.astrale.ai` for a
 * `*.beta.astrale.ai` route, else `https://shell.astrale.ai`. It was never the user's choice, and a
 * Shell reinstalled from an immutable deployment no longer answers at it. Only these exact values
 * are dropped, and only from a managed bookmark: any other `domainIssuer` is an explicit exact
 * issuer and the canonical resolver honours it.
 */
const ROUTE_DERIVED_SHELL_ISSUERS: ReadonlySet<string> = new Set([
  'https://shell.astrale.ai',
  'https://shell.beta.astrale.ai',
])

/**
 * Read a managed bookmark written before the pin read: drop the route-derived Shell issuer, so the
 * bookmark exchanges through the installed Shell whose issuer the Kernel pin names. The caller
 * applies it to managed bookmarks only, on every read and to the entry every bookmark write stores.
 *
 * The write side is part of the same read-old rule, not a rule of the canonical model: a read
 * cannot tell these values from the ones an earlier release stored, so a value stored now, even one
 * given explicitly with `--domain-issuer`, would be dropped by the next read. The write drops it at
 * once instead, and `instance bookmark` warns that it was not stored.
 *
 * @deprecated The installed Shell's issuer is read from the Kernel pin (`schema.inspect` of
 * `shell.astrale.ai`, see `connection/installed-issuer.ts`). Delete only together with a bookmark
 * store migration that rewrites every store, or a breaking release that refuses a store still
 * carrying one of these values. Reads never persist this drop and only a bookmark write rewrites a
 * store, so a store an earlier release wrote can keep the value however recent the CLI is; without
 * this check the canonical resolver would take it for an explicit issuer and exchange both Instance
 * and Admin calls at the route-derived Shell issuer. Deleting it also ends the write-side drop: a
 * bookmark write then stores these values like any explicit exact issuer, which is the intended
 * behaviour once no store can still carry one an earlier release wrote.
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
