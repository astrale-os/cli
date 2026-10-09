import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillsRoot = join(cliRoot, 'skills')

function markdownFiles(root) {
  return readdirSync(root)
    .flatMap((name) => {
      const path = join(root, name)
      if (statSync(path).isDirectory()) return markdownFiles(path)
      return name.endsWith('.md') ? [path] : []
    })
    .sort()
}

/** The lines of every fenced code block: what a reader copies and runs. */
function codeLines(source) {
  const lines = []
  let open = false
  for (const line of source.split('\n')) {
    if (/^\s*```/.test(line)) {
      open = !open
      continue
    }
    if (open) lines.push(line)
  }
  return lines
}

const skills = markdownFiles(skillsRoot).map((path) => ({
  file: relative(skillsRoot, path),
  source: readFileSync(path, 'utf8'),
}))

test('no skill example uses a deploy-time installation surface or a removed flag', () => {
  // A deploy never installs: `installation`, `--deploy-only`, `signingIdentity` and the `dev` loop
  // are gone from canonical projects; installation accepts only the immutable deployment URL.
  const removed = [
    [/--deploy-only\b/, '--deploy-only'],
    [/\binstallation\s*:/, 'an Environment installation'],
    [/\bsigningIdentity\b/, 'signingIdentity'],
    [/\.astrale\/identity\.json/, 'a signing identity file'],
    [/\bpnpm (?:run )?(?:dev|prod)\b/, 'a pnpm dev or prod script'],
    [/\bastrale-domain dev\b/, 'astrale-domain dev'],
    [/\sdomain install\b.*\s--direct(?:\s|$)/, 'install --direct'],
  ]
  for (const { file, source } of skills) {
    for (const line of codeLines(source)) {
      for (const [pattern, name] of removed) {
        assert.doesNotMatch(line, pattern, `${file}: ${name} in an example: ${line.trim()}`)
      }
    }
  }
})

test('no skill says a deploy installs, or teaches the removed development session', () => {
  for (const { file, source } of skills) {
    assert.doesNotMatch(source, /\bpnpm prod\b/, file)
    assert.doesNotMatch(source, /installs once/i, file)
    assert.doesNotMatch(source, /reconciles installation/i, file)
    assert.doesNotMatch(source, /Session locks/, file)
    assert.doesNotMatch(source, /deployment-only Publication change/i, file)
    // A deployment serves its release; a Publication is the registry entry for a version.
    assert.doesNotMatch(
      source,
      /Publication\/JWKS|deployed Publication|intrinsic Publication/,
      file,
    )
  }
})

test('the CLI README says a deploy never installs and names no installation target', () => {
  const readme = readFileSync(join(cliRoot, 'README.md'), 'utf8')
  assert.doesNotMatch(readme, /\bpnpm (?:run )?(?:dev|prod)\b/)
  assert.doesNotMatch(readme, /installation target/i)
  assert.doesNotMatch(readme, /deployment and installation alive/i)
  assert.match(
    readme,
    /`pnpm run deploy <environment>` makes one immutable deployment, prints its URL\s+and never installs/,
  )
  assert.match(readme, /`astrale domain install <url> -i <instance>`/)
})

test('the release guide is routed and states the three commands and their effects', () => {
  const router = readFileSync(join(skillsRoot, 'astrale-domain', 'SKILL.md'), 'utf8')
  assert.match(
    router,
    /Deploy, install, publish or yank a version[^\n]*\n[^\n]*`references\/release\.md`/,
  )

  const release = readFileSync(
    join(skillsRoot, 'astrale-domain', 'references', 'release.md'),
    'utf8',
  )
  assert.match(release, /\| `astrale-domain deploy <environment>` \| yes \| no \| no \|/)
  assert.match(
    release,
    /\| `astrale-domain publish <environment>` \| yes, deploy included \| yes, the `package\.json` version \| no \|/,
  )
  assert.match(
    release,
    /\| `astrale domain install <reference>\.\.\. -i <instance>` \| no \| no \| yes \|/,
  )
  assert.match(release, /Publishing never\s+installs/)
  // Consent classes (D7): same line bare, another line by origin, a terminal confirmation.
  assert.match(release, /same line[^]*`--allow-issuer-change`;/)
  assert.match(release, /another line[^]*`--allow-issuer-change=<origin>`/)
  // release-please (D5) and the publish order (tech [.73345]).
  assert.match(release, /`Release-As: 2\.0\.0` footer or a `feat!:` commit/)
  assert.match(release, /--allow-dirty/)
  assert.match(release, /astrale-domain yank 1\.5\.0/)
  // D18: one owner per instance.
  assert.match(release, /Give each instance one owner, a developer\s+or CI, never both/)
  // AM-4': a deploy binds the current secrets to the new deployment only; rotation is in place.
  assert.match(release, /binds the Environment's current secrets to the new deployment only/)
  assert.match(release, /--admin -d @rotate\.json/)
  assert.match(release, /--admin -d - --json/)
  assert.match(
    release,
    /pnpm provider:platform-secret -- --label <label> --name <NAME> < value-file/,
  )
})

test('Studio tells its agent and the env editor that a deploy never installs', () => {
  const prompt = readFileSync(
    join(cliRoot, 'studio', 'server', 'agent', 'prompts', 'system.ts'),
    'utf8',
  )
  const editor = readFileSync(
    join(cliRoot, 'studio', 'client', 'src', 'components', 'env-editor.tsx'),
    'utf8',
  )
  for (const source of [prompt, editor]) {
    assert.doesNotMatch(source, /pnpm prod/)
    assert.match(source, /`pnpm run deploy <environment>`/)
  }
  assert.match(prompt, /never installs; then `astrale domain install <url> -i <instance>`/)
  assert.match(prompt, /\/\.well-known\/astrale\/release\.json/)
})
