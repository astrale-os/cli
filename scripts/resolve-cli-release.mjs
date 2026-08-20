import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const RELEASE_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(alpha|beta|rc)(?:\.(?:0|[1-9]\d*))?)?$/

export function resolveCliRelease({
  releaseVersion = '',
  refType = '',
  refName = '',
  sha = '',
  binaryVersion,
}) {
  if (!binaryVersion) throw new Error('Could not resolve package version from package.json')

  let version = releaseVersion.trim()
  let immutableTag = ''

  if (version) {
    immutableTag = `cli/v${version}`
  } else if (refType === 'tag' && refName.startsWith('cli/v')) {
    version = refName.slice('cli/v'.length)
    immutableTag = refName
  } else {
    if (!/^[0-9a-f]{12,}$/i.test(sha)) throw new Error('Canary releases require a commit SHA')
    return {
      version: `main-${sha.slice(0, 12)}`,
      binary_version: binaryVersion,
      immutable_tag: '',
      channel: 'canary',
      prerelease: 'true',
    }
  }

  const match = RELEASE_VERSION.exec(version)
  if (!match) {
    throw new Error(
      `Unsupported release version "${version}"; use stable semver or -alpha, -beta, or -rc`,
    )
  }
  if (binaryVersion !== version) {
    throw new Error(
      `Release version ${version} does not match package version ${binaryVersion}; Release Please must own both`,
    )
  }

  const channel = match[1] ?? 'stable'
  return {
    version,
    binary_version: binaryVersion,
    immutable_tag: immutableTag,
    channel,
    prerelease: String(channel !== 'stable'),
  }
}

function main() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const metadata = resolveCliRelease({
    releaseVersion: process.env.RELEASE_VERSION,
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    sha: process.env.GITHUB_SHA,
    binaryVersion: pkg.version,
  })
  const lines = Object.entries(metadata)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`)
  else process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
