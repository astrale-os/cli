import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/cli-release.yml', 'utf8'))
const generation = workflow.jobs.publish.steps.find(
  (step) => step.name === 'Generate update manifest',
).run

for (const historical of [false, true]) {
  test(`release manifest shell emits the exact ${historical ? 'historical v2 bytes' : 'single-binary format'}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'astrale-release-manifest-'))
    try {
      const assets = join(root, 'release-assets')
      mkdirSync(assets)
      const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']
      const sha = 'a'.repeat(64)
      for (const platform of platforms)
        writeFileSync(join(assets, `astrale-${platform}.tar.gz`), 'fixture')
      writeFileSync(
        join(assets, 'sha256sums.txt'),
        platforms.map((platform) => `${sha}  astrale-${platform}.tar.gz\n`).join(''),
      )
      const values = {
        'steps.meta.outputs.version': '1.0.0-beta.83',
        'steps.meta.outputs.binary_version': '1.0.0-beta.83',
        'steps.meta.outputs.channel': 'beta',
        'steps.cohort.outputs.cloudflared_version': historical ? '2026.8.2' : '',
        'github.repository': 'astrale-os/cli',
      }
      const script = generation.replace(/\$\{\{\s*(.*?)\s*\}\}/gu, (_, key) => {
        assert.ok(Object.hasOwn(values, key), `unqualified workflow input: ${key}`)
        return values[key]
      })
      const emitted = spawnSync('sh', ['-c', script], { cwd: root, encoding: 'utf8' })
      assert.equal(emitted.status, 0, emitted.stderr)
      // Historical immutable manifests must retain both content and byte order.
      const expected = [
        '{',
        ...(historical ? ['  "schemaVersion": 2,'] : []),
        '  "version": "1.0.0-beta.83",',
        '  "binaryVersion": "1.0.0-beta.83",',
        ...(historical ? ['  "cloudflaredVersion": "2026.8.2",'] : []),
        '  "channel": "beta",',
        '  "repo": "astrale-os/cli",',
        '  "assets": {',
        platforms
          .map(
            (platform) =>
              `    "${platform}": { "name": "astrale-${platform}.tar.gz", "sha256": "${sha}" }`,
          )
          .join(',\n'),
        '  }',
        '}',
        '',
      ].join('\n')
      assert.equal(readFileSync(join(assets, 'manifest.json'), 'utf8'), expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
