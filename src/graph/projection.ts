/** Strip a fully-qualified Property key to the leaf used by CLI presentation. */
export function unqualifyProperty(key: string): string {
  const property = key.lastIndexOf('.property.')
  if (property >= 0) return key.slice(property + '.property.'.length)
  const slash = key.lastIndexOf('/')
  return slash >= 0 ? key.slice(slash + 1) : key
}

/** Read an exact key first, then one canonical qualified key with the requested leaf. */
export function nodeProperty(
  node: { readonly props: Readonly<Record<string, unknown>> } | null | undefined,
  name: string,
): unknown {
  const props = node?.props
  if (props === undefined) return undefined
  if (Object.hasOwn(props, name)) return props[name]
  for (const [key, value] of Object.entries(props)) {
    if (unqualifyProperty(key) === name) return value
  }
  return undefined
}
