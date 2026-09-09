// Keep probes independent of repository dependencies and close only our own sessions.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')

const mode = process.argv[2]
function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 45_000 })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${binary} ${args[0]} failed: ${result.error?.message ?? ''}\n${result.stderr ?? ''}${result.stdout ?? ''}`,
    )
  }
  return result.stdout
}

async function main() {
  if (mode === 'module') {
    let directory = path.dirname(fs.realpathSync(process.argv[3]))
    while (directory !== path.dirname(directory)) {
      const manifest = path.join(directory, 'package.json')
      if (
        fs.existsSync(manifest) &&
        JSON.parse(fs.readFileSync(manifest, 'utf8')).name === 'playwright'
      ) {
        require(directory).chromium.executablePath()
        process.stdout.write(`${directory}\n`)
        return
      }
      directory = path.dirname(directory)
    }
    throw new Error('Cannot resolve the Playwright installation from its executable')
  }
  const { chromium } = require(process.env.AGENT_PLAYWRIGHT_MODULE)
  if (mode === 'executable') {
    process.stdout.write(`${chromium.executablePath()}\n`)
    return
  }
  const executable = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  fs.accessSync(executable, fs.constants.X_OK)
  if (mode === 'playwright') {
    const browser = await chromium.launch({
      executablePath: executable,
      headless: true,
      timeout: 30_000,
    })
    try {
      const page = await browser.newPage()
      await page.setContent('<title>Astrale setup</title><button>Ready</button>')
      if ((await page.title()) !== 'Astrale setup') throw new Error('Playwright page probe failed')
    } finally {
      await browser.close()
    }
  } else if (mode === 'agent-browser') {
    const args = ['--session', `astrale-setup-${process.pid}`, '--executable-path', executable]
    try {
      command('agent-browser', [...args, 'open', 'about:blank'])
      if (
        !command('agent-browser', [...args, 'eval', '"astrale-setup-ok"']).includes(
          'astrale-setup-ok',
        )
      ) {
        throw new Error('agent-browser evaluation failed')
      }
    } finally {
      command('agent-browser', [...args, 'close'])
    }
  } else if (mode === 'chrome-devtools') {
    const args = ['--sessionId', randomUUID()]
    try {
      const launch = [...args, 'start', '--headless', '--isolated', '--executablePath', executable]
      // Cloud VMs run as root; leave the browser sandbox enabled for ordinary local users.
      if (process.getuid?.() === 0) launch.push('--chromeArg=--no-sandbox')
      command('chrome-devtools', launch)
      const pages = command('chrome-devtools', [...args, 'list_pages'])
      if (!pages.includes('about:blank'))
        throw new Error(`Chrome DevTools page probe failed: ${pages}`)
    } finally {
      command('chrome-devtools', [...args, 'stop'])
    }
  } else {
    throw new Error(`Unknown browser probe: ${mode}`)
  }
  process.stdout.write(`[agent-setup] ${mode}: browser launch verified\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
