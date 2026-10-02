/**
 * Managed bookmarks written before the CLI read the Shell issuer from the Kernel pin.
 *
 * Those releases stored, and repaired on every read, `domainIssuer` on a bookmark of an
 * Astrale-managed Instance: the Shell issuer derived from the route suffix
 * (`https://shell.astrale.ai` or `https://shell.beta.astrale.ai`). A Shell installed from a
 * deployment URL no longer answers at that issuer, so the stored value is read and dropped: the
 * next bookmark write persists the bookmark without it.
 *
 * @deprecated The installed Shell's issuer is read from the Kernel pin (`schema.inspect` of
 * `shell.astrale.ai`, see `connection/installed-issuer.ts`). Delete once no supported CLI release
 * predates that read, so no bookmark store can still carry a route-derived Shell issuer.
 */
export function withoutManagedShellIssuer<Entry extends { readonly domainIssuer?: string }>(
  entry: Entry,
): Entry {
  if (entry.domainIssuer === undefined) return entry
  const { domainIssuer: _routeDerived, ...rest } = entry
  return rest as Entry
}
