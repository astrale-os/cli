// The CLI's npm distribution is discontinued. Install its public standalone release assets.
// This follows cli/install.sh's manifest, archive closure, checksum and install metadata contract
// without downloading or executing a remote shell script during setup.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { execFileSync } = require('node:child_process')

function install() {
  const platform = `${process.platform}-${process.arch}`
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform)) {
    throw new Error(`Unsupported Astrale CLI platform: ${platform}`)
  }
  const directory = path.join(process.env.AGENT_SETUP_HOME, 'astrale/bin')
  const metadataDirectory = process.env.ASTRALE_HOME || path.join(os.homedir(), '.astrale')
  fs.mkdirSync(directory, { recursive: true })
  fs.mkdirSync(metadataDirectory, { recursive: true })
  const lock = path.join(directory, '.astrale-install.lock')
  fs.mkdirSync(lock) // Respect concurrent CLI installs/updates; never remove someone else's lock.
  const owner = `${process.pid} ${randomUUID()}\n`
  fs.writeFileSync(path.join(lock, 'owner'), owner, { mode: 0o600 })
  const temporary = fs.mkdtempSync(path.join(directory, '.download-'))
  const binary = path.join(directory, 'astrale')
  const previous = path.join(temporary, 'previous')
  let replaced = false
  let committed = false
  try {
    const base = 'https://github.com/astrale-os/cli/releases/download'
    function download(url, file) {
      execFileSync(
        'curl',
        ['--fail', '--location', '--silent', '--show-error', '--retry', '2', url, '-o', file],
        {
          stdio: 'inherit',
          timeout: 180_000,
        },
      )
    }
    const manifestPath = path.join(temporary, 'manifest.json')
    download(`${base}/beta/manifest.json`, manifestPath)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const asset = manifest.assets?.[platform]
    const name = `astrale-${platform}.tar.gz`
    if (
      manifest.schemaVersion !== undefined ||
      manifest.repo !== 'astrale-os/cli' ||
      !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version ?? '') ||
      typeof manifest.binaryVersion !== 'string' ||
      typeof manifest.channel !== 'string' ||
      asset?.name !== name ||
      !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')
    ) {
      throw new Error('Invalid Astrale standalone release manifest')
    }
    const archive = path.join(temporary, name)
    // Fetch the immutable release selected by the channel manifest, avoiding channel movement races.
    download(`${base}/cli/v${manifest.version}/${name}`, archive)
    const checksum = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    if (checksum !== asset.sha256) throw new Error('Astrale archive checksum mismatch')
    if (execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim() !== 'astrale') {
      throw new Error('Astrale archive must contain exactly one standalone executable')
    }
    execFileSync('tar', ['-xzf', archive, '-C', temporary])
    const candidate = path.join(temporary, 'astrale')
    if (!fs.lstatSync(candidate).isFile())
      throw new Error('Astrale executable is not a regular file')
    fs.chmodSync(candidate, 0o755)
    if (
      execFileSync(candidate, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim() !==
      manifest.binaryVersion
    ) {
      throw new Error('Astrale executable version does not match its release manifest')
    }
    const metadata = path.join(metadataDirectory, `install.json.${process.pid}.next`)
    fs.writeFileSync(
      metadata,
      JSON.stringify(
        {
          method: 'script',
          channel: manifest.channel,
          version: manifest.version,
          repo: manifest.repo,
          bin: binary,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    )
    try {
      if (fs.existsSync(binary)) fs.renameSync(binary, previous)
      fs.renameSync(candidate, binary)
      replaced = true
      fs.renameSync(metadata, path.join(metadataDirectory, 'install.json'))
      committed = true
    } finally {
      if (!committed) {
        if (replaced) fs.rmSync(binary, { force: true })
        if (fs.existsSync(previous)) fs.renameSync(previous, binary)
      }
      fs.rmSync(metadata, { force: true })
    }
    process.stdout.write(`[agent-setup] Installed standalone Astrale ${manifest.version}\n`)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
    if (fs.readFileSync(path.join(lock, 'owner'), 'utf8') === owner)
      fs.rmSync(lock, { recursive: true })
  }
}

try {
  install()
} catch (error) {
  process.stderr.write(`[agent-setup] Astrale installation failed: ${error.message}\n`)
  process.exitCode = 1
}
