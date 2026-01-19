import type { AvatarId } from '@astrale-os/kernel-core'
import boxen from 'boxen'
import chalk from 'chalk'
import { exec } from 'child_process'
import { Command } from 'commander'
import ora from 'ora'
import {
  clearProfileAuth,
  getActiveProfile,
  getProfileAuth,
  listProfiles,
  setProfileAuth,
} from '../lib/global-config'
import {
  pollForTokens,
  requestDeviceAuthorization,
  type WorkOSAuthResult,
} from '../lib/workos-auth'

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${cmd} "${url}"`)
}

function hyperlink(text: string, url: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`
}

async function interactiveLogin(profileName: string): Promise<WorkOSAuthResult> {
  const deviceAuth = await requestDeviceAuthorization()
  const urlLink = hyperlink(
    chalk.white(deviceAuth.verification_uri_complete),
    deviceAuth.verification_uri_complete,
  )

  const boxContent = [
    chalk.dim('1. Open this URL in your browser:'),
    `   ${urlLink}`,
    '',
    chalk.dim('2. Confirm this code:'),
    chalk.yellow.bold(`   ${deviceAuth.user_code}`),
  ].join('\n')

  const box = boxen(boxContent, {
    padding: 1,
    borderColor: 'white',
    borderStyle: 'round',
    title: `Authenticating for profile: ${profileName}`,
    titleAlignment: 'center',
  })

  console.log(`\n${box}\n`)

  const spinner = ora({
    text: 'Waiting for authorization... (Press Enter to open browser)',
    color: 'white',
  }).start()

  const onStdinData = (data: Buffer) => {
    const char = data.toString()
    if (char === '\r' || char === '\n') {
      spinner.text = 'Opening browser...'
      openBrowser(deviceAuth.verification_uri_complete)
      setTimeout(() => {
        spinner.text = 'Waiting for authorization...'
      }, 1000)
    }
    if (char === '\u0003') {
      cleanup()
      process.exit(1)
    }
  }
  const cleanup = () => {
    if (process.stdin.isTTY) {
      process.stdin.off('data', onStdinData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
  }
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onStdinData)
  }

  try {
    const tokens = await pollForTokens(
      deviceAuth.device_code,
      deviceAuth.expires_in,
      deviceAuth.interval,
    )
    cleanup()
    spinner.succeed(chalk.green('Successfully logged in!'))
    return {
      avatarId: tokens.user.id as AvatarId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      user: tokens.user,
    }
  } catch (error) {
    cleanup()
    spinner.fail(chalk.red('Authorization failed'))
    throw error
  }
}

export async function runLogin(profileName?: string): Promise<void> {
  const profile = profileName ?? (await getActiveProfile())
  try {
    const result = await interactiveLogin(profile)
    await setProfileAuth(profile, {
      avatarId: result.avatarId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    })
    const displayName = result.user.first_name
      ? `${result.user.first_name} ${result.user.last_name || ''}`.trim()
      : result.user.email
    console.log(
      chalk.dim(`  Logged in as ${chalk.bold(displayName)} on profile ${chalk.bold(profile)}\n`),
    )
  } catch (error) {
    console.error(chalk.red('Login failed:'), error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

async function runLogout(profileName?: string): Promise<void> {
  const profile = profileName ?? (await getActiveProfile())
  const auth = await getProfileAuth(profile)
  if (!auth) {
    console.log(chalk.dim(`\n[astrale] Not authenticated for profile: ${profile}`))
    return
  }
  await clearProfileAuth(profile)
  console.log(chalk.green(`\n✓ Logged out from profile: ${profile}`))
}

async function runStatus(): Promise<void> {
  const profiles = await listProfiles()
  console.log(chalk.dim(`\n  Profile       Status              Avatar`))
  console.log(chalk.dim(`  ─────────────────────────────────────────────────`))
  for (const p of profiles) {
    const marker = p.isActive ? chalk.cyan('*') : ' '
    const statusText = p.isAuthenticated
      ? chalk.green('authenticated')
      : chalk.dim('not authenticated')
    const auth = p.isAuthenticated ? ((await getProfileAuth(p.name))?.avatarId ?? '') : ''
    const avatarShort = auth ? auth.slice(0, 20) + (auth.length > 20 ? '...' : '') : chalk.dim('-')
    console.log(`${marker} ${p.name.padEnd(12)} ${statusText.padEnd(30)} ${avatarShort}`)
  }
  console.log('')
}

export const authCommand = new Command('auth').description('Manage authentication')

authCommand.addCommand(
  new Command('login')
    .description('Authenticate with Astrale via WorkOS')
    .option('--profile <name>', 'Profile to authenticate')
    .action(async (opts) => {
      try {
        await runLogin(opts.profile)
      } catch (err) {
        console.error('[astrale] Auth login failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    }),
)

authCommand.addCommand(
  new Command('logout')
    .description('Clear authentication for a profile')
    .option('--profile <name>', 'Profile to logout from')
    .action(async (opts) => {
      try {
        await runLogout(opts.profile)
      } catch (err) {
        console.error('[astrale] Auth logout failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    }),
)

authCommand.addCommand(
  new Command('status')
    .description('Show authentication status for all profiles')
    .action(async () => {
      try {
        await runStatus()
      } catch (err) {
        console.error('[astrale] Auth status failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    }),
)
