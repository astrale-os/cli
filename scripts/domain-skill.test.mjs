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
  const development = readFileSync(join(root, 'references', 'development.md'), 'utf8')
  const debugging = readFileSync(join(root, 'references', 'debugging.md'), 'utf8')
  const performance = readFileSync(join(root, 'references', 'performance.md'), 'utf8')
  const security = readFileSync(join(root, 'references', 'security.md'), 'utf8')
  const simulating = readFileSync(join(root, 'references', 'simulating.md'), 'utf8')

  assert.match(entrypoint, /Keep authorization in Schema-owned Policy and callable `auth` mode/)
  assert.match(entrypoint, /`node\(\)` for topology-owned matching/)
  assert.match(implementing, /defineAction/)
  assert.match(implementing, /defineWorkflow/)
  assert.match(implementing, /Action context has no `step`/)
  assert.match(implementing, /graph\.self\.query\(readVisit/)
  assert.match(implementing, /graph\.self\.mutate\(recordForecast/)
  assert.match(implementing, /Default `query` and `mutate` use the admitted union authority/)
  assert.match(
    implementing,
    /Select `graph\.self` for Domain-owned facts,\s+`graph\.caller` for caller-only authority, and `graph\.union` only deliberately/,
  )
  assert.match(implementing, /`domain` is the exact resolved Domain/)
  assert.match(
    implementing,
    /`executeQuery\(client, \.\.\.\)` and `executeMutation\(client, \.\.\.\)`/,
  )
  assert.match(implementing, /dependencies: \{ kernel: KernelSchema \}/)
  assert.match(implementing, /functions:\s*\[K\.functions\.query, K\.functions\.mutate\]/)
  assert.match(implementing, /still return Kernel `2004` when these\s+requirements are absent/)
  assert.match(
    implementing,
    /`K\.functions\.provision` for `client\.auth\.provision\(\.\.\.\)`,\s+only when used/,
  )
  assert.match(implementing, /materialize `can_use` authority\s+for the Domain principal/)
  assert.match(
    implementing,
    /do not create a `requirements\/`\s+layer, forge keys, or grant the invoking human `can_use`/i,
  )
  assert.match(implementing, /functions\/register-visit\/index\.ts/)
  assert.match(implementing, /Layer\s+roots are curated re-export facades and contain no behavior/)
  assert.match(implementing, /defineQuery<typeof schema>\(\)\(\(domain\)/)
  assert.match(implementing, /mutation\.transition\(\{/)
  assert.match(integrations, /defineIntegration/)
  assert.match(integrations, /Runtime `initialize\(environment\)`/)
  assert.match(development, /Use ordinary imports for pure helpers and Rules/)
  assert.match(development, /resolves a relative preset `secrets` path from that same directory/)
  assert.match(development, /`pnpm run cleanup:graph -- --instance \.\.\.`/)
  assert.match(development, /normalize at most that one package-manager\s+separator/)
  assert.match(development, /`build` returns before declared secrets are loaded/)
  assert.match(development, /declare `zod` directly in the\s+Domain manifest/)
  assert.match(development, /Do not create a\s+top-level `requirements\/` source tree/)
  assert.match(debugging, /Treat authentication and provision journal inputs as secret/)
  assert.match(entrypoint, /invoke every public Action and Workflow definition/)
  assert.match(entrypoint, /representative success and applicable refusal inputs/)
  assert.match(simulating, /Binding metadata, lower-level AST checks/)
  assert.match(simulating, /one tested\s+handler cannot stand in for an unexecuted public callable/)
  assert.match(modeling, /Object definitions\s+belong to one Class hierarchy/)
  assert.match(modeling, /rather than parallel object-definition kinds/)
  assert.match(modeling, /One exported `stateMachine` is the authority for a finite lifecycle/)
  assert.match(modeling, /`stateProperty\(machine\)`/)
  assert.match(modeling, /`machine\.stateSchema` or `machine\.eventSchema`/)
  assert.match(
    modeling,
    /`node\(Class\)` includes that Class when concrete and every active concrete descendant/,
  )
  assert.match(modeling, /preserve its behavior with `node\.exact\(Class\)`/)
  assert.match(security, /Policy Node selectors are authorization scope, not a typing convenience/)
  assert.match(security, /concrete descendant in the success evidence/)
  assert.match(performance, /Kernel resolves\s+`node\(Class\)` through the pinned Registry/)
  assert.match(performance, /narrows that set from\s+the variable's Edge endpoints/)
  assert.match(views, /defineFrontend/)
  assert.match(views, /astrale-frontend-design/)
  assert.match(views, /Do not depend directly on Shell or\s+Shell-React packages/)
  assert.match(views, /Class read or traversal Policy narrows an existing principal capability/)
  assert.match(views, /validate it as a `NodeId` and pass `\{ id \}` to `useAction\.run`/)
  assert.match(views, /Do not forge a\s+`BoundNode`/)
})
