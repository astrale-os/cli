const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { test } = require('node:test')

const packages = ['studio', 'studio/e2e/fixture', 'studio/e2e/fixture/peer']

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cli setup-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const scripts = path.join(root, 'scripts/setup/agent')
  fs.cpSync(__dirname, scripts, { recursive: true })
  fs.writeFileSync(path.join(root, '.nvmrc'), process.versions.node + '\n')
  fs.writeFileSync(path.join(root, '.bun-version'), '1.4.0\n')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@12.1.0', devDependencies: { typescript: '7.0.2' } }),
  )
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages: [' + packages.join(', ') + ']\n',
  )
  for (const directory of packages) {
    fs.mkdirSync(path.join(root, directory), { recursive: true })
    fs.writeFileSync(
      path.join(root, directory, 'package.json'),
      JSON.stringify({
        devDependencies: {
          typescript: '7.0.2',
        },
      }),
    )
  }
  fs.writeFileSync(path.join(root, 'scripts/build-embedded-assets.ts'), '// fixture')
  const home = path.join(root, 'home')
  const storage = path.join(root, 'tools')
  const bin = path.join(storage, 'bin')
  fs.mkdirSync(home)
  fs.mkdirSync(bin, { recursive: true })
  const env = {
    ...process.env,
    // pnpm injects a module-resolution fallback to its own dependencies.
    // Fixtures must resolve only their own packages, including missing-package checks.
    NODE_OPTIONS: '',
    NODE_PATH: '',
    HOME: home,
    AGENT_SETUP_HOME: storage,
    AGENT_HARNESSES: 'codex,claude',
    AGENT_SETUP_BROWSER: '',
    AGENT_SETUP_ASTRALE_CLI: '',
    CLAUDE_ENV_FILE: '',
    CLAUDE_CODE_REMOTE: '',
    TEST_LOG: path.join(root, 'calls'),
  }
  function run(script, args = [], extra = {}) {
    return spawnSync('bash', [path.join(scripts, script), ...args], {
      cwd: os.tmpdir(),
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 15_000,
    })
  }
  function executable(name, body) {
    fs.writeFileSync(
      path.join(bin, name),
      '#!/usr/bin/env bash\nset -euo pipefail\n' + body + '\n',
      {
        mode: 0o755,
      },
    )
  }
  function mock(body) {
    fs.appendFileSync(path.join(scripts, 'lib/common.sh'), '\n' + body)
  }
  assert.equal(spawnSync('git', ['init', '--initial-branch=feature', root]).status, 0)
  return { root, scripts, storage, env, run, executable, mock }
}

function success(result) {
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
}

test('the configured local Claude hook only loads prepared paths', (t) => {
  const f = fixture(t)
  const settings = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../.claude/settings.json'), 'utf8'),
  )
  const envFile = path.join(f.root, 'claude.env')
  fs.writeFileSync(path.join(f.storage, 'env.sh'), 'export CLI_SETUP_CHECK=ready\n')
  const result = spawnSync('bash', ['-c', settings.hooks.SessionStart[0].hooks[0].command], {
    env: {
      ...f.env,
      CLAUDE_PROJECT_DIR: f.root,
      CLAUDE_ENV_FILE: envFile,
      CLAUDE_CODE_REMOTE: 'false',
    },
    encoding: 'utf8',
  })
  success(result)
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'export CLI_SETUP_CHECK=ready\n')
  assert.equal(fs.existsSync(path.join(f.storage, 'state')), false)
})

function cloudFixture(t) {
  const f = fixture(t)
  fs.writeFileSync(
    path.join(f.scripts, 'setup.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
echo setup >> "$TEST_LOG"
sleep 0.1
printf 'export CLI_SETUP_CHECK=ready\\n' > "$AGENT_SETUP_HOME/env.sh"
`,
  )
  fs.writeFileSync(
    path.join(f.scripts, 'verify.sh'),
    `#!/usr/bin/env bash
echo verify >> "$TEST_LOG"
[[ "\${TEST_FAIL_VERIFY:-0}" == 0 ]]
`,
  )
  f.env.CLAUDE_CODE_REMOTE = 'true'
  return f
}

test(
  'concurrent cloud hooks initialize once and a later hook only restores paths',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const f = cloudFixture(t)
    const launch = (name) =>
      new Promise((resolve, reject) => {
        const child = spawn('bash', [path.join(f.scripts, 'claude_session_start.sh')], {
          env: { ...f.env, CLAUDE_ENV_FILE: path.join(f.root, name) },
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (data) => {
          stdout += data
        })
        child.stderr.on('data', (data) => {
          stderr += data
        })
        child.on('error', reject)
        child.on('close', (status) => resolve({ status, stdout, stderr }))
      })
    const results = await Promise.all([launch('first.env'), launch('second.env')])
    for (const result of results) success(result)
    assert.equal(
      results.filter((result) => result.stdout.includes('"reloadSkills":true')).length,
      1,
    )
    assert.equal(fs.readFileSync(f.env.TEST_LOG, 'utf8'), 'setup\nverify\n')
    const directory = path.join(f.storage, 'state/claude')
    const marker = path.join(
      directory,
      fs.readdirSync(directory).find((name) => name.endsWith('.ready')),
    )
    const before = fs.statSync(marker).mtimeMs
    const resumed = await launch('resumed.env')
    success(resumed)
    assert.match(resumed.stderr, /already initialized; loading environment only/)
    assert.equal(fs.statSync(marker).mtimeMs, before)
    assert.equal(fs.readFileSync(f.env.TEST_LOG, 'utf8'), 'setup\nverify\n')
    assert.equal(
      fs.readFileSync(path.join(f.root, 'resumed.env'), 'utf8'),
      'export CLI_SETUP_CHECK=ready\n',
    )
  },
)

test(
  'failed cloud verification leaves no success marker and the next hook retries',
  { skip: process.platform !== 'linux' },
  (t) => {
    const f = cloudFixture(t)
    const failed = f.run('claude_session_start.sh', [], { TEST_FAIL_VERIFY: '1' })
    assert.notEqual(failed.status, 0)
    const state = path.join(f.storage, 'state/claude')
    assert.equal(fs.readdirSync(state).filter((name) => name.endsWith('.ready')).length, 0)
    success(f.run('claude_session_start.sh'))
    assert.equal(fs.readdirSync(state).filter((name) => name.endsWith('.ready')).length, 1)
    assert.equal(fs.readFileSync(f.env.TEST_LOG, 'utf8'), 'setup\nverify\nsetup\nverify\n')
  },
)

test('preflight rejects incomplete checkouts and invalid Bun pins before runtime execution', (t) => {
  const f = fixture(t)
  for (const name of ['node', 'npm', 'pnpm', 'bun'])
    f.executable(name, 'echo unexpected >> "$TEST_LOG"; exit 99')
  success(f.run('setup_repo.sh', ['--check']))
  fs.writeFileSync(path.join(f.root, '.bun-version'), 'latest')
  assert.match(f.run('setup.sh').stderr, /exact Bun version/)
  fs.writeFileSync(path.join(f.root, '.bun-version'), '1.4.0')
  fs.rmSync(path.join(f.root, 'studio/e2e/fixture/peer/package.json'))
  assert.match(f.run('setup.sh').stderr, /Incomplete CLI checkout/)
  assert.equal(fs.existsSync(f.env.TEST_LOG), false)
})
test('pinned Bun reuses the managed version instead of the wrong host runtime', (t) => {
  const f = fixture(t)
  f.executable('bun', 'echo 1.2.14')
  const bin = path.join(f.storage, 'cli-bun/1.4.0/bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'bun'), '#!/bin/sh\necho 1.4.0\n', { mode: 0o755 })
  f.mock('agent_npm_install() { echo unexpected >> "$TEST_LOG"; exit 99; }')
  fs.writeFileSync(
    path.join(f.scripts, 'pin.sh'),
    'source "' +
      path.join(f.scripts, 'lib/common.sh') +
      '"\nsource "' +
      path.join(f.scripts, 'lib/repo.sh') +
      '"\ncli_ensure_bun\n',
  )
  success(f.run('pin.sh'))
  success(f.run('pin.sh'))
  assert.equal(fs.realpathSync(path.join(f.storage, 'bin/bun')), path.join(bin, 'bun'))
  assert.equal(fs.existsSync(f.env.TEST_LOG), false)
})
test('default setup installs once per call and prepares assets without global CLI or browsers', (t) => {
  const f = fixture(t)
  f.mock(
    'agent_ensure_node() { :; }\nagent_install_repo() { echo install >> "$TEST_LOG"; cd "$AGENT_REPO_ROOT"; }\nagent_select_browser() { exit 99; }\nagent_ensure_skill() { exit 99; }',
  )
  f.executable('bun', 'echo 1.4.0')
  f.executable('astrale', 'exit 99')
  f.executable('pnpm', '[[ "$*" == "run assets:ensure" ]] || exit 99; echo assets >> "$TEST_LOG"')
  success(f.run('setup_repo.sh'))
  success(f.run('setup_repo.sh'))
  assert.equal(fs.readFileSync(f.env.TEST_LOG, 'utf8'), 'install\nassets\ninstall\nassets\n')
})
test('asset build failure prevents successful repository preparation', (t) => {
  const f = fixture(t)
  f.mock('agent_ensure_node() { :; }\nagent_install_repo() { cd "$AGENT_REPO_ROOT"; }')
  f.executable('bun', 'echo 1.4.0')
  f.executable('pnpm', 'exit 43')
  assert.equal(f.run('setup_repo.sh').status, 43)
  assert.equal(fs.existsSync(path.join(f.storage, 'env.sh')), false)
})
test('readiness rejects missing assets without generating them', (t) => {
  const f = fixture(t)
  fs.mkdirSync(path.join(f.root, 'node_modules'))
  fs.writeFileSync(path.join(f.root, 'node_modules/.modules.yaml'), 'fixture')
  fs.mkdirSync(path.join(f.root, 'studio/node_modules'))
  f.executable('bun', 'echo 1.4.0')
  f.executable('pnpm', 'if [[ "$*" == --version ]]; then echo 12.1.0; else echo fixture; fi')
  const r = f.run('verify.sh')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /Embedded assets are missing/)
  assert.equal(fs.existsSync(path.join(f.root, 'src/generated/embedded-assets.ts')), false)
})
