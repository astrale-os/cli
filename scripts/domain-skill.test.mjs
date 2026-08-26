import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'astrale-domain')

test('the shipped Domain skill teaches the current SDK authoring boundary', () => {
  const files = [
    join(root, 'SKILL.md'),
    ...readdirSync(join(root, 'references')).map((name) => join(root, 'references', name)),
  ]
  const source = files.map((path) => readFileSync(path, 'utf8')).join('\n')

  for (const removed of [
    'defineDomain',
    'bindWorkflow',
    'remoteMethod',
    'remoteInterface',
    'HandlerOf',
    'frontendArtifact',
    'viteFrontend',
    'viewFor',
    'createInlineStep',
    'defineCore',
    'definePolicy',
    'ActionServices',
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${removed}\\b`), removed)
  }
  assert.doesNotMatch(source, /from ['"]@astrale-os\/kernel-(?:core|dsl)/)
  assert.doesNotMatch(source, /auth:\s*['"](?:required|optional|public)['"]/, 'removed auth mode')
  assert.doesNotMatch(
    source,
    /kernel\.(?:get|getOrThrow|children|neighbors|query|mutate|reconcile)\b/,
  )
  assert.doesNotMatch(source, /wrap every (?:kernel call|effect).*step\.run/i)
  assert.doesNotMatch(source, /return\s*\{\s*deps\s*:/)
  assert.doesNotMatch(source, /context\.work\b/)
  assert.doesNotMatch(source, /context\.activation\b/)

  const entrypoint = readFileSync(join(root, 'SKILL.md'), 'utf8')
  const implementing = readFileSync(join(root, 'references', 'implementing.md'), 'utf8')
  const integrations = readFileSync(join(root, 'references', 'integrations.md'), 'utf8')
  const modeling = readFileSync(join(root, 'references', 'modeling.md'), 'utf8')
  const views = readFileSync(join(root, 'references', 'views.md'), 'utf8')

  assert.match(entrypoint, /Keep authorization in Schema-owned Policy and callable `auth` mode/)
  assert.match(implementing, /defineAction/)
  assert.match(implementing, /defineWorkflow/)
  assert.match(implementing, /Action context has no `step`/)
  assert.match(implementing, /`query` and `mutate` execute authored definitions/)
  assert.match(implementing, /`domain` is the exact resolved Domain/)
  assert.match(
    implementing,
    /`executeQuery\(client, \.\.\.\)` and `executeMutation\(client, \.\.\.\)`/,
  )
  assert.match(integrations, /defineIntegration/)
  assert.match(integrations, /Runtime `initialize\(environment\)`/)
  assert.match(
    readFileSync(join(root, 'references', 'development.md'), 'utf8'),
    /Use ordinary imports for pure helpers and Rules/,
  )
  assert.match(modeling, /Object definitions\s+belong to one Class hierarchy/)
  assert.match(modeling, /rather than parallel object-definition kinds/)
  assert.match(views, /defineFrontend/)
  assert.match(views, /astrale-frontend-design/)
  assert.match(views, /Do not depend directly on Shell or\s+Shell-React packages/)
})
