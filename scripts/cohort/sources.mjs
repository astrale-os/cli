function source(name, repository, path, packages) {
  return Object.freeze({
    name,
    repository,
    path,
    packages: Object.freeze(
      packages.map(([packageName, directory]) => Object.freeze({ name: packageName, directory })),
    ),
  })
}

export const exactSources = Object.freeze([
  source('kernel', 'astrale-os/kernel', '.cohort/kernel', [
    ['kernel-client', 'client'],
    ['kernel-core', 'core'],
    ['kernel-dsl', 'dsl'],
    ['kernel-protocol', 'protocol'],
    ['kernel-server', 'server'],
  ]),
  source('sdk', 'astrale-os/sdk', '.cohort/sdk', [['sdk', '.']]),
  source('shell', 'astrale-os/shell', '.cohort/shell', [['shell', 'packages/shell']]),
])

export const exactWorkspaceMembers = Object.freeze(
  exactSources.flatMap(({ path, packages }) =>
    packages.map(({ directory }) => (directory === '.' ? path : `${path}/${directory}`)),
  ),
)

export const exactOverrides = Object.freeze(
  exactSources.flatMap(({ path, packages }) =>
    packages.map(({ name, directory }) =>
      Object.freeze({ name, path: directory === '.' ? path : `${path}/${directory}` }),
    ),
  ),
)
