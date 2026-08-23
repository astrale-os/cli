#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { parse } from 'yaml'

import { exactSourceAction } from './action.mjs'
import { exactInstalledSources } from './installation.mjs'
import { exactPublicationInstall } from './publication.mjs'
import { exactReleaseSecret } from './release.mjs'
import { exactOverrides, exactSources } from './sources.mjs'
import { exactSourceWorkflow } from './workflow.mjs'
import { exactSourceWorkspace } from './workspace.mjs'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const token = '${{ secrets.COHORT_REPOSITORY_TOKEN }}'
const revisions = exactSourceAction(read('.github/actions/exact-sources/action.yml'))
exactSourceWorkflow(read('.github/workflows/ci.yml'), ['compatibility', 'studio-browser'], token)
exactSourceWorkflow(read('.github/workflows/cli-release.yml'), ['test', 'build'], token)
exactSourceWorkflow(read('.github/workflows/publish.yml'), ['publish'], token)
exactReleaseSecret(read('.github/workflows/release.yml'), read('.github/workflows/cli-release.yml'))
exactPublicationInstall(read('.github/workflows/publish.yml'))

const workspaceSource = read('pnpm-workspace.yaml')
exactSourceWorkspace(workspaceSource)
const workspace = parse(workspaceSource)
for (const { name, path } of exactOverrides) {
  if (workspace.overrides?.[`@astrale-os/${name}`] !== `link:${path}`) {
    throw new TypeError(`Missing exact source override for @astrale-os/${name}.`)
  }
}
if (!read('.gitignore').split('\n').includes('.cohort')) {
  throw new TypeError('The exact source directory must be ignored.')
}
const expectedRoots = Object.fromEntries(
  exactSources.map(({ name, path }) => [name, realpathSync(new URL(`${path}/`, root))]),
)
const packageRoots = {}
for (const source of exactSources) {
  const roots = {}
  for (const { name } of source.packages) {
    const path = new URL(`node_modules/@astrale-os/${name}/`, root)
    if (!existsSync(path)) throw new TypeError(`Missing exact source package @astrale-os/${name}.`)
    const repository = git(realpathSync(path), 'rev-parse', '--show-toplevel')
    roots[name] = repository
    if (git(repository, 'rev-parse', 'HEAD') !== revisions[source.name]) {
      throw new TypeError(`@astrale-os/${name} does not resolve from exact ${source.name} source.`)
    }
  }
  packageRoots[source.name] = roots
}
exactInstalledSources(
  {
    packages: packageRoots,
    sdkKernel: realpathSync(new URL('.cohort/sdk/.cohort/kernel/', root)),
  },
  expectedRoots,
)

process.stdout.write(
  `PASS exact Kernel ${revisions.kernel}, SDK ${revisions.sdk}, and Shell ${revisions.shell} sources\n`,
)

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}
