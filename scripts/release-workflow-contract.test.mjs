import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parse } from 'yaml'

const read = (path) => readFileSync(path, 'utf8')
const workflow = (path) => parse(read(path))

describe('release workflow contract', () => {
  const config = JSON.parse(read('.release-please-config.json'))
  const release = workflow('.github/workflows/release.yml')
  const binary = workflow('.github/workflows/cli-release.yml')
  const ci = workflow('.github/workflows/ci.yml')
  const uiSearch = workflow('.github/workflows/ui-search-contract.yml')

  it('uses Release Please beta versioning and the canonical CLI tag shape', () => {
    assert.equal(config.versioning, 'prerelease')
    assert.equal(config.prerelease, true)
    assert.equal(config['prerelease-type'], 'beta')
    assert.equal(config['tag-separator'], '/')
    assert.equal(config['always-update'], true)
    assert.deepEqual(
      config['changelog-sections'].find(({ type }) => type === 'docs'),
      { type: 'docs', hidden: true },
    )
  })

  it('ships v1 only as a private, standalone package', () => {
    const manifest = JSON.parse(read('package.json'))
    assert.equal(manifest.private, true)
    assert.equal(manifest.publishConfig, undefined)
    assert.equal(existsSync('.github/workflows/publish.yml'), false)
  })

  it('runs the binary publisher only after Release Please creates a release', () => {
    const sharedRelease = release.jobs.release.steps.find((step) => step.id === 'release')
    assert.equal(
      sharedRelease.uses,
      'astrale-os/config/.github/actions/release@8e2e2abd0320be0c2f64033916519ab3b66c7dd7',
    )
    assert.equal(
      release.jobs.release.outputs.created,
      '${{ steps.release.outputs.releases_created }}',
    )
    assert.equal(release.jobs.release.outputs.version, '${{ steps.version.outputs.version }}')
    assert.equal(release.jobs.binary.needs, 'release')
    assert.equal(release.jobs.binary.if, "needs.release.outputs.created == 'true'")
    assert.equal(release.jobs.binary.uses, './.github/workflows/cli-release.yml')
    assert.equal(release.jobs.binary.with.version, '${{ needs.release.outputs.version }}')
  })

  it('accepts the Release Please version through a reusable binary workflow', () => {
    assert.equal(binary.on.workflow_call.inputs.version.required, true)
    assert.equal(binary.on.workflow_call.inputs.version.type, 'string')
    assert.deepEqual(binary.on.push.tags, ['cli/v*'])
    assert.equal(binary.on.push.branches, undefined)

    const metadata = binary.jobs.publish.steps.find((step) => step.id === 'meta')
    assert.equal(metadata.env.RELEASE_VERSION, '${{ inputs.version }}')
    assert.match(metadata.run, /node scripts\/resolve-cli-release\.mjs/)

    const summary = binary.jobs.publish.steps.at(-1)
    assert.match(summary.run, /ASTRALE_CHANNEL=\$\{\{ steps\.meta\.outputs\.channel \}\} sh/)
  })

  it('updates the mutable channel ref through authenticated GitHub API calls', () => {
    const channel = binary.jobs.publish.steps.find(
      (step) => step.name === 'Publish channel release',
    )
    assert.equal(channel.env.BINARY_VERSION, '${{ steps.meta.outputs.binary_version }}')
    assert.match(channel.run, /gh api --method PATCH/)
    assert.match(channel.run, /gh api --method POST/)
    assert.match(channel.run, /git\/refs\/tags\/\$CHANNEL/)
    assert.match(
      channel.run,
      /node \.release-tooling\/scripts\/publish-release-assets\.mjs --mutable "\$CHANNEL" release-assets/,
    )
    assert.doesNotMatch(channel.run, /git push/)
    assert.match(channel.run, /compare\/\$current_sha\.\.\.\$EXPECTED_COMMIT/)
    assert.match(channel.run, /ahead\)/)
    assert.match(channel.run, /identical\)/)
  })

  it('delegates immutable and channel asset publication to the qualified helper', () => {
    const immutable = binary.jobs.publish.steps.find(
      (step) => step.name === 'Publish immutable version release',
    )
    const channel = binary.jobs.publish.steps.find(
      (step) => step.name === 'Publish channel release',
    )
    const toolingCheckouts = binary.jobs.publish.steps.filter(
      (step) =>
        step.uses?.startsWith('actions/checkout@') && step.with?.path === '.release-tooling',
    )
    assert.equal(toolingCheckouts.length, 1)
    assert.equal(toolingCheckouts[0].with.ref, '${{ github.workflow_sha }}')
    assert.equal(immutable.env.BINARY_VERSION, '${{ steps.meta.outputs.binary_version }}')
    assert.equal(immutable.env.CHANNEL, '${{ steps.meta.outputs.channel }}')
    assert.match(
      immutable.run,
      /node \.release-tooling\/scripts\/publish-release-assets\.mjs "\$TAG" release-assets/,
    )
    assert.match(
      immutable.run,
      /node \.release-tooling\/scripts\/publish-release-assets\.mjs --verify-tag "\$TAG" "\$EXPECTED_COMMIT"/,
    )
    assert.match(immutable.run, /gh release create "\$TAG" --verify-tag/)
    assert.ok(
      immutable.run.indexOf(' --verify-tag "$TAG" "$EXPECTED_COMMIT"') <
        immutable.run.indexOf('gh release create'),
      'the immutable tag must be verified before a missing release can be created',
    )
    assert.doesNotMatch(immutable.run, /--clobber/)
    assert.doesNotMatch(immutable.run, /release upload .*release-assets\/\*/)
    assert.doesNotMatch(channel.run, /release upload .*release-assets\/\*/)
    assert.doesNotMatch(channel.run, /ahead\|identical/)
    assert.equal(channel.run.match(/gh api --method PATCH/gu)?.length, 1)
    assert.ok(
      channel.run.indexOf('ahead)') < channel.run.indexOf('gh api --method PATCH') &&
        channel.run.indexOf('gh api --method PATCH') < channel.run.indexOf('identical)'),
      'an identical recovered channel ref must not be patched again',
    )
    assert.deepEqual(binary.jobs.publish.concurrency, {
      group: 'cli-release-channel-publication',
      'cancel-in-progress': false,
    })
  })

  it('builds every supported standalone platform exactly once per release run', () => {
    const platforms = binary.jobs.build.strategy.matrix.include.map(
      ({ target_os: os, target_arch: arch }) => `${os}-${arch}`,
    )
    assert.deepEqual(platforms.sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
    const build = binary.jobs.build.steps.find((step) => step.name === 'Build binary').run
    const source = binary.jobs.build.steps.find((step) => step.id === 'source')
    const pack = binary.jobs.build.steps.find((step) => step.name === 'Package asset').run
    assert.equal(binary.env.BUN_VERSION, '1.4.0')
    assert.match(source.run, /git rev-parse HEAD/)
    assert.match(build, /bun scripts\/build-embedded-assets\.ts/)
    assert.doesNotMatch(build, /bun scripts\/build-viewer\.ts/)
    assert.doesNotMatch(build, /bun run --cwd studio build/)
    assert.doesNotMatch(build, /bun scripts\/generate-embedded-assets\.ts/)
    assert.match(build, /bun build --compile/)
    assert.match(
      build,
      /--define '__ASTRALE_SOURCE_REVISION__="\$\{\{ steps\.source\.outputs\.sha \}\}"'/,
    )
    assert.match(pack, /node scripts\/package-release-asset\.mjs dist\/astrale "\$asset\.tar\.gz"/)
    assert.deepEqual(
      pack
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('tar ')),
      [
        `tar -tzf "$asset.tar.gz" | grep -qx 'astrale'`,
        `tar -xzf "$asset.tar.gz" -C dist/archive-check`,
      ],
    )
    assert.match(pack, /cmp dist\/astrale dist\/archive-check\/astrale/)
    assert.match(pack, /test -x dist\/archive-check\/astrale/)
    assert.doesNotMatch(pack, /viewer/)
  })

  it('rejects stale embedded assets in ordinary CI', () => {
    const buildIndex = ci.jobs.compatibility.steps.findIndex(
      (step) => step.name === 'Build development artifacts',
    )
    const check = ci.jobs.compatibility.steps[buildIndex + 1]
    assert.equal(check.name, 'Check embedded assets are current')
    assert.match(check.run, /git diff --exit-code -- src\/generated\/embedded-assets\.ts/)
  })

  it('qualifies the current UI producer through the exact CLI search consumer', () => {
    assert.equal(ci.jobs['ui-search-contract'].uses, './.github/workflows/ui-search-contract.yml')
    assert.equal(ci.jobs['ui-search-contract'].with['ui-ref'], 'main')
    assert.equal(uiSearch.on.workflow_call.inputs['ui-ref'].required, true)
    assert.equal(uiSearch.on.workflow_dispatch.inputs['ui-ref'].required, true)
    const providerCheckout = uiSearch.jobs['provider-consumer'].steps.find(
      (step) => step.with?.repository === 'astrale-os/ui',
    )
    assert.equal(providerCheckout.with.ref, '${{ inputs.ui-ref }}')
    const qualification = uiSearch.jobs['provider-consumer'].steps.find(
      (step) => step.name === 'Qualify exact UI producer through the CLI consumer',
    )
    assert.match(qualification.run, /pnpm qualification:ui-search/u)
  })

  it('rebuilds pinned embedded inputs before compiling a development bundle', () => {
    const build = read('scripts/build.ts')
    assert.ok(
      build.indexOf('await buildEmbeddedAssets()') <
        build.indexOf('const result = await Bun.build'),
    )

    const embedded = read('scripts/build-embedded-assets.ts')
    assert.match(embedded, /readFile\(new URL\('\.\.\/\.bun-version'/)
    assert.match(embedded, /Bun\.version !== expectedBun/)
  })

  it('qualifies skill reconciliation before and after publishing', () => {
    const buildQualification = binary.jobs.build.steps.find(
      (step) => step.name === 'Qualify skill update with the built binary',
    )
    assert.equal(buildQualification.env.ASTRALE_E2E_CLI, './dist/astrale')
    assert.equal(
      buildQualification.env.ASTRALE_E2E_SOURCE_REVISION,
      '${{ steps.source.outputs.sha }}',
    )
    assert.match(buildQualification.run, /pnpm test:skills-e2e/)

    const publishedQualification = binary.jobs.publish.steps.find(
      (step) => step.name === 'Qualify the published channel binary',
    )
    assert.match(publishedQualification.run, /gh release download "\$CHANNEL"/)
    assert.match(publishedQualification.run, /astrale-linux-x64\.tar\.gz/)
    assert.match(publishedQualification.run, /scripts\/qualification\/skills-update-e2e\.mjs/)
    assert.equal(
      publishedQualification.env.ASTRALE_E2E_SOURCE_REVISION,
      '${{ steps.source.outputs.sha }}',
    )

    const publishNode = binary.jobs.publish.steps.find((step) =>
      step.uses?.startsWith('actions/setup-node@'),
    )
    assert.equal(publishNode.with['node-version-file'], '.nvmrc')
  })

  it('installs one binary and delegates global skill configuration to it', () => {
    const installer = read('install.sh')
    const studioSkills = read('studio/client/src/components/settings/skills.tsx')
    assert.doesNotMatch(installer, /install -m 0644 .*viewer/)
    assert.match(installer, /astrale" skills configure/)
    assert.match(installer, /astrale" skills update --json/)
    assert.match(studioSkills, /astrale skills configure/)
    assert.doesNotMatch(studioSkills, /npx skills add astrale-os\/cli/)
  })

  it('pins every external action to one immutable revision', () => {
    for (const [name, document] of Object.entries({ release, binary, ci, uiSearch })) {
      for (const job of Object.values(document.jobs)) {
        for (const step of job.steps ?? []) {
          if (typeof step.uses !== 'string' || step.uses.startsWith('./')) continue
          assert.match(step.uses, /@[0-9a-f]{40}$/u, `${name} leaves ${step.uses} mutable`)
          if (step.uses.startsWith('actions/checkout@')) {
            assert.equal(
              step.with?.['persist-credentials'],
              false,
              `${name} checkout must not persist credentials`,
            )
            if (name === 'binary') {
              if (step.with?.path === '.release-tooling') {
                assert.equal(step.with.ref, '${{ github.workflow_sha }}')
              } else {
                assert.equal(
                  step.with?.ref,
                  "${{ inputs.version != '' && format('refs/tags/cli/v{0}', inputs.version) || github.sha }}",
                  'binary recovery must build its requested immutable tag',
                )
              }
            }
          }
        }
      }
    }
  })

  it('defaults standalone installs to beta while retaining the channel override', () => {
    const installer = read('install.sh')
    assert.equal(installer.match(/\$\{ASTRALE_CHANNEL:-beta\}/g)?.length, 2)
    assert.doesNotMatch(installer, /\$\{ASTRALE_CHANNEL:-alpha\}/)
  })

  it('documents both the one-time beta entry and stable promotion', () => {
    const guide = read('docs/release.md')
    assert.match(guide, /fix\(ci\): automate CLI beta releases/)
    assert.match(guide, /Release-As: 1\.0\.0-beta\.0/)
    assert.match(guide, /chore\(ci\): promote CLI releases to stable/)
    assert.match(guide, /Release-As: 1\.0\.0/)
    assert.match(guide, /Keep `"tag-separator": "\/"`/)
    assert.match(guide, /standalone `stable` channel/)
    assert.match(guide, /Bun 1\.4\.0/)
    assert.match(guide, /Approve workflows to run/)
    assert.match(guide, /action_required/)
  })
})
