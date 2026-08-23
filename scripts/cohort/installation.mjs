/** Prove every installed package and SDK-internal link uses the materialized physical roots. */
export function exactInstalledSources(actual, expected) {
  for (const [source, packages] of Object.entries(actual.packages)) {
    for (const [name, root] of Object.entries(packages)) {
      if (root !== expected[source]) {
        throw new TypeError(`Exact ${source} package ${name} resolves from another physical root.`)
      }
    }
  }
  if (actual.sdkKernel !== expected.kernel) {
    throw new TypeError('SDK Kernel source link resolves from another physical root.')
  }
  return Object.freeze({ ...expected })
}
