import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CLI_RELEASE_ASSETS,
  localAssets,
  publishReleaseAssets,
  resolveReleaseTagCommit,
  validateCliReleaseClosure,
} from './publish-release-assets.mjs'

const repository = 'astrale-os/cli'
const api = `repos/${repository}`
const runGh = (args) => spawnSync('gh', args, { encoding: 'utf8' })

export async function promote(release, { apply = false, gh = runGh } = {}) {
  if (
    !/^cli\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(?:0|[1-9]\d*))?$/u.test(
      release,
    )
  ) {
    throw new Error('Use an exact CLI release tag, e.g. cli/v1.0.0-beta.85')
  }
  const command = (args) => {
    const result = gh(args)
    if (result.status !== 0) throw new Error(result.stderr?.trim() || 'gh failed')
    return result.stdout
  }
  const json = (path) => JSON.parse(command(['api', path]))
  const metadata = json(`${api}/releases/tags/${release}`)
  if (metadata.draft || metadata.tag_name !== release) throw new Error('Release must be published')
  const commit = resolveReleaseTagCommit({ tag: release, repository, gh })
  const runs = json(`${api}/actions/runs?head_sha=${commit}&status=success&per_page=100`)
  const qualification = runs.workflow_runs.find((entry) => {
    if (
      entry.head_sha !== commit ||
      entry.conclusion !== 'success' ||
      !['.github/workflows/release.yml', '.github/workflows/cli-release.yml'].includes(entry.path)
    )
      return false
    const jobs = json(`${api}/actions/runs/${entry.id}/jobs?per_page=100`).jobs
    return jobs.some(
      (job) =>
        job.conclusion === 'success' &&
        job.steps.some(
          (step) =>
            step.name === 'Qualify the published channel binary' && step.conclusion === 'success',
        ),
    )
  })
  if (!qualification) throw new Error(`No successful CLI Release qualification for ${commit}`)
  const current = gh(['api', `${api}/releases/tags/latest`])
  if (current.status !== 0 && !current.stderr?.includes('(HTTP 404)')) {
    throw new Error(current.stderr?.trim() || 'Could not inspect latest')
  }
  const previous = current.status === 0 ? JSON.parse(current.stdout) : undefined
  const directory = await mkdtemp(join(tmpdir(), 'astrale-promote-'))
  try {
    command(['release', 'download', release, '--repo', repository, '--dir', directory])
    const assets = await localAssets(directory)
    if (
      JSON.stringify(assets.map(({ name }) => name).sort()) !==
      JSON.stringify([...CLI_RELEASE_ASSETS].sort())
    ) {
      throw new Error('Incomplete CLI release asset set')
    }
    for (const asset of assets) {
      const remote = metadata.assets.find(({ name }) => name === asset.name)
      if (remote?.digest !== asset.digest || remote.size !== asset.size) {
        throw new Error(`Downloaded asset differs from immutable release: ${asset.name}`)
      }
    }
    const version = release.slice('cli/v'.length)
    await validateCliReleaseClosure(directory, assets, {
      version,
      binaryVersion: version,
      repo: repository,
    })
    const manifestPath = join(directory, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const report = {
      mode: apply ? 'apply' : 'dry-run',
      release,
      commit,
      qualification: qualification.html_url,
      previous: previous?.body ?? null,
      version,
      channel: 'latest',
      assets: assets.map(({ name, digest }) => ({ name, digest })),
    }
    console.log(JSON.stringify(report, null, 2))
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## CLI promotion (${report.mode})\n\nSource: ${release} (${commit})\n\n` +
          `Qualification: ${report.qualification}\n\nPrevious: ${report.previous ?? 'absent'}\n\nSelected: ${version}\n`,
      )
    }
    if (!apply) return report
    // Only channel metadata changes; the four archives and their checksums remain byte-identical.
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...manifest, channel: 'latest' }, null, 2)}\n`,
    )
    const ref = gh(['api', `${api}/git/ref/tags/latest`])
    if (ref.status === 0 && JSON.parse(ref.stdout).object?.sha !== commit) {
      command([
        'api',
        '--method',
        'PATCH',
        `${api}/git/refs/tags/latest`,
        '-f',
        `sha=${commit}`,
        '-F',
        'force=true',
      ])
    } else if (ref.status === 0) {
      // The selected commit is already retained.
    } else if (ref.stderr?.includes('(HTTP 404)')) {
      command([
        'api',
        '--method',
        'POST',
        `${api}/git/refs`,
        '-f',
        'ref=refs/tags/latest',
        '-f',
        `sha=${commit}`,
      ])
    } else throw new Error(ref.stderr?.trim() || 'Could not inspect latest ref')
    const notes = `Promoted ${release} (${commit}). Qualification: ${qualification.html_url}`
    if (!previous || previous.body !== notes || previous.prerelease !== metadata.prerelease) {
      command([
        'release',
        previous ? 'edit' : 'create',
        'latest',
        '--repo',
        repository,
        '--title',
        'Astrale CLI latest',
        '--notes',
        notes,
        `--prerelease=${metadata.prerelease}`,
        '--latest=false',
      ])
    }
    await publishReleaseAssets({
      tag: 'latest',
      directory,
      mutable: true,
      requiredAssets: CLI_RELEASE_ASSETS,
      expectedManifest: { version, binaryVersion: version, channel: 'latest', repo: repository },
      gh: (args) => gh(args[0] === 'release' ? [...args, '--repo', repository] : args),
    })
    if (resolveReleaseTagCommit({ tag: 'latest', repository, gh }) !== commit) {
      throw new Error('latest ref verification failed')
    }
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\nLatest ref and all six assets verified.\n')
    return report
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [release, flag, ...extra] = process.argv.slice(2)
  if (extra.length || (flag !== undefined && flag !== '--apply')) {
    console.error('Usage: node scripts/promote.mjs <cli-release-tag> [--apply]')
    process.exitCode = 1
  } else {
    promote(release, { apply: flag === '--apply' }).catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
  }
}
