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

  // `defineDomain` is current again: astrale-os/sdk#603 (0.6.0-beta.11) gave the name to the Domain
  // definition and removed `defineApplication`.
  for (const removed of [
    'defineApplication',
    'bindWorkflow',
    'remoteMethod',
    'remoteInterface',
    'HandlerOf',
    'frontendArtifact',
    'viteFrontend',
    'viewFor',
    'useTargetPath',
    'useViewsFor',
    'setTarget',
    'pickView',
    'createInlineStep',
    'defineCore',
    'definePolicy',
    'ActionServices',
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${removed}\\b`), removed)
  }
  assert.doesNotMatch(
    source,
    /@astrale-os\/sdk\/application\b/,
    'removed @astrale-os/sdk/application',
  )
  assert.doesNotMatch(source, /from ['"]@astrale-os\/kernel-(?:core|dsl)/)
  assert.doesNotMatch(source, /view\(\{[^}]*\btarget\s*:/, 'class-targeted View')
  assert.doesNotMatch(source, /auth:\s*['"](?:required|optional|public)['"]/, 'removed auth mode')
  assert.doesNotMatch(
    source,
    /kernel\.(?:get|getOrThrow|children|neighbors|query|mutate|reconcile)\b/,
  )
  assert.doesNotMatch(source, /wrap every (?:kernel call|effect).*step\.run/i)
  assert.doesNotMatch(source, /return\s*\{\s*deps\s*:/)
  assert.doesNotMatch(source, /context\.work\b/)
  assert.doesNotMatch(source, /context\.activation\b/)
  assert.doesNotMatch(source, /\.union\.(?:invoke|query|mutate)\b/, 'removed union authority mode')
})

test('the shipped skills name Query v7 after the Query, never a recipe', () => {
  const skills = join(root, '..')
  for (const name of readdirSync(skills, { recursive: true })) {
    if (!String(name).endsWith('.md')) continue
    const text = readFileSync(join(skills, String(name)), 'utf8')
    assert.doesNotMatch(text, /recipe/i, String(name))
  }
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
  const authority = readFileSync(join(root, 'references', 'authority.md'), 'utf8')
  const actions = readFileSync(join(root, 'references', 'actions.md'), 'utf8')
  const schema = readFileSync(join(root, 'references', 'schema.md'), 'utf8')
  const policies = readFileSync(join(root, 'references', 'policies.md'), 'utf8')
  assert.match(
    authority,
    /\| `kernel`, `graph` \| The executor: `kernel.invoke\(\.\.\.\)` acts as the Domain \|/,
  )
  assert.match(authority, /`graph.caller`, `kernel.caller`, `dependencies.<alias>.caller`/)
  assert.match(authority, /None: a call without `as` throws/)
  assert.match(authority, /Use `extends_with` alone/)
  assert.match(actions, /no\s+`expect` or `schemaExpectation` option/)
  assert.match(schema, /Only abstract Method obligations are inherited/)
  assert.match(schema, /A concrete Class can declare `abstract: true`/)
  assert.match(schema, /Use `method.executable`/)
  assert.match(actions, /A\s+missing handler rejects the Runtime/)
  assert.match(schema, /Instance Methods require an instance of their exact declaring Class/)
  assert.match(
    policies,
    /`kernel.auth.register\(\.\.\.\)` admits a caller that extends `identity.registrar`/,
  )
})

test('the guides keep the boundary rules a reader cannot derive', () => {
  const read = (name) => readFileSync(join(root, 'references', name), 'utf8')
  assert.match(read('queries.md'), /identity breaking every tie/)
  assert.match(read('migration.md'), /Past it, the Class is refused\s+`budget-exceeded`/)
  assert.match(
    read('migration.md'),
    /a View renamed, a\s+Class removed, a Core Node no longer declared/,
  )
  assert.match(read('policies.md'), /Revocation lags by up to `maxAge`/)
  assert.match(read('schema.md'), /Only a Function takes bytes/)
  assert.match(read('schema.md'), /A durable callable\s+takes and answers values only/)
})

test('the shipped skills mention legacy capability authority only as deprecated', () => {
  const skills = join(root, '..')
  const files = readdirSync(skills, { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(skills, name))
  for (const path of files) {
    for (const paragraph of readFileSync(path, 'utf8').split(/\n\s*\n/)) {
      if (!/\bcan_(?:use|read|traverse|create|update|delete)\b|\bcanUseSyscall\b/.test(paragraph))
        continue
      assert.match(paragraph, /Deprecated/, `${path} teaches legacy capability authority`)
    }
  }
  const domain = files
    .filter((path) => path.startsWith(root))
    .map((path) => readFileSync(path, 'utf8'))
  for (const source of domain)
    assert.doesNotMatch(source, /requirements\(\{\s*(?:functions|classes|authority|core)\s*:/)
})
