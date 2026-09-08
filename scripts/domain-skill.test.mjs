import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'astrale-domain')

test('the shipped Domain skill avoids removed APIs and private Kernel imports', () => {
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
})

test('the Domain skill router reaches existing reference files without orphaned guides', () => {
  const entrypoint = readFileSync(join(root, 'SKILL.md'), 'utf8')
  const references = [...entrypoint.matchAll(/`(references\/[\w-]+\.md)`/g)].map(
    (match) => match[1],
  )
  assert.ok(references.length > 0, 'the router must expose its guides')
  for (const reference of references) {
    assert.ok(existsSync(join(root, reference)), `broken skill reference: ${reference}`)
  }
  for (const name of readdirSync(join(root, 'references'))) {
    assert.ok(references.includes(`references/${name}`), `unreachable guide: ${name}`)
  }
})

test('the reorganized guides retain current authority and exact Method semantics', () => {
  const runtime = readFileSync(join(root, 'references', 'runtime.md'), 'utf8')
  const schema = readFileSync(join(root, 'references', 'schema.md'), 'utf8')
  const policies = readFileSync(join(root, 'references', 'policies.md'), 'utf8')
  assert.match(
    runtime,
    /Default `query`, `mutate`, and `kernel` use the installed Domain authority/,
  )
  assert.match(runtime, /`graph.caller` or `kernel.caller`/)
  assert.match(runtime, /dependencies.messaging.invoke/)
  assert.match(runtime, /no `expect` or `schemaExpectation` option/)
  assert.match(schema, /Only abstract Method obligations are inherited/)
  assert.match(schema, /A concrete Class can declare `abstract: true`/)
  assert.match(schema, /Use `method.executable`/)
  assert.match(runtime, /A missing handler rejects the Runtime/)
  assert.match(schema, /Instance Methods require an instance of their exact declaring Class/)
  assert.match(policies, /`kernel.auth.register\(\.\.\.\)` requires `K.functions.register`/)
})
