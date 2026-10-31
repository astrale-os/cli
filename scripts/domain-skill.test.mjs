import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const skills = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
const root = join(skills, 'astrale-domain')
const legacyRoot = join(root, 'references', 'legacy')

/** Every Markdown file under a directory, with its path. */
function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
}

/** The top-level guides of the router, without the `legacy/` folder. */
function guideNames() {
  return readdirSync(join(root, 'references'), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}

test('the shipped Domain skill avoids removed APIs and private Kernel imports', () => {
  const source = markdownFiles(root)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

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

test('the Domain skill router reaches existing reference files without orphaned guides', () => {
  const entrypoint = readFileSync(join(root, 'SKILL.md'), 'utf8')
  const references = [...entrypoint.matchAll(/`(references\/[\w-]+\.md)`/g)].map(
    (match) => match[1],
  )
  assert.ok(references.length > 0, 'the router must expose its guides')
  for (const reference of references) {
    assert.ok(existsSync(join(root, reference)), `broken skill reference: ${reference}`)
  }
  for (const name of guideNames()) {
    assert.ok(references.includes(`references/${name}`), `unreachable guide: ${name}`)
  }
  assert.doesNotMatch(entrypoint, /references\/legacy\//, 'the router links only target guides')
})

test("legacy guides are deprecated, ledgered and reached only from their target's migration section", () => {
  const ledger = readFileSync(join(legacyRoot, 'LEDGER.md'), 'utf8')
  const rows = [...ledger.matchAll(/^\| (L-CLI-\d+) \|(.*)$/gm)]
  const guides = readdirSync(legacyRoot).filter((name) => name !== 'LEDGER.md')
  assert.ok(guides.length > 0, 'an empty legacy folder must be deleted with its ledger')
  const everyPage = markdownFiles(skills)
  for (const name of guides) {
    const guide = readFileSync(join(legacyRoot, name), 'utf8')
    const banner = guide.match(/^# .+\(deprecated\)\n\n> \*\*Deprecated \((L-CLI-\d+)\)\.\*\*/)
    assert.ok(banner, `legacy/${name} opens with its deprecation banner`)
    assert.match(guide, /\*\*Replaced by\*\*/, `legacy/${name} names its replacement`)
    assert.match(guide, /\*\*Removal:\*\*/, `legacy/${name} states its removal condition`)
    const row = rows.find((match) => match[1] === banner[1])
    assert.ok(row, `${banner[1]} has a ledger row`)
    assert.ok(row[2].includes(`(\`legacy/${name}\`)`), `${banner[1]} names legacy/${name}`)
    const seam = row[2].match(/`(references\/[\w-]+\.md)`, its only link/)
    assert.ok(seam, `${banner[1]} names its seam page`)

    // The one link: the seam page's migration section. No other page names the legacy guide.
    for (const path of everyPage) {
      if (path.startsWith(legacyRoot)) continue
      const text = readFileSync(path, 'utf8')
      const mentions = [...text.matchAll(new RegExp(`legacy/${name.replace('.', '\\.')}`, 'g'))]
      if (path !== join(root, seam[1])) {
        assert.equal(mentions.length, 0, `${path} links legacy/${name} outside its seam`)
        continue
      }
      const migration = text.indexOf('\n## Migrating from ')
      assert.ok(migration > 0, `${seam[1]} has a migration section`)
      assert.ok(mentions.length > 0, `${seam[1]} links legacy/${name}`)
      for (const mention of mentions) {
        assert.ok(mention.index > migration, `${seam[1]} links legacy/${name} only when migrating`)
      }
    }
  }
})

test('target guides show only the Roles model of accounts and requirements', () => {
  const legacyNames = [
    /\bmember_of_group\b/,
    /extends:\s*\[\s*S\.classes\.(?:User|Group)\b/,
    /\bShell\.(?:User|Group)\b/,
    /\bownsUserOrGroupClass\b/,
    /\b(?:recordProfile|listEntrypoints|assignViews|claimedEmail|claimedName|creationKey)\b/,
    /\b(?:belongsToGroup|administersShellClass|usesFunction)\b/,
    /requirements\(\{\s*(?:functions|classes|authority|core)\s*:/,
    /\bfunctions:\s*\[\s*K\.functions\./,
    /\bS\.core\.nodes\.(?:admin|member)\b/,
  ]
  for (const path of markdownFiles(skills)) {
    if (path.startsWith(legacyRoot)) continue
    let text = readFileSync(path, 'utf8')
    const migration = text.indexOf('\n## Migrating from ')
    if (migration >= 0) text = text.slice(0, migration)
    for (const name of legacyNames) assert.doesNotMatch(text, name, `${path}: ${name}`)
  }
  const accounts = readFileSync(join(root, 'references', 'users.md'), 'utf8')
  assert.match(accounts, /check\(hasRole, ref\(/)
  assert.match(accounts, /holds_account/)
  assert.match(accounts, /S\.core\.nodes\['profile\.admin'\]/)
  assert.match(accounts, /requirements\.domain/)
  assert.match(accounts, /K1/)
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
  assert.match(runtime, /no `expect` or `schemaExpectation` option/)
  assert.match(schema, /Only abstract Method obligations are inherited/)
  assert.match(schema, /A concrete Class can declare `abstract: true`/)
  assert.match(schema, /Use `method.executable`/)
  assert.match(runtime, /A missing handler rejects the Runtime/)
  assert.match(schema, /Instance Methods require an instance of their exact declaring Class/)
  assert.match(policies, /`kernel.auth.register\(\.\.\.\)` requires `K.functions.register`/)
})
