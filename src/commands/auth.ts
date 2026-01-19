import type { AvatarId } from '@astrale-os/kernel-core'
import { Command } from 'commander'
import readline from 'readline'
import {
  clearProfileAuth,
  getActiveProfile,
  getProfileAuth,
  listProfiles,
  setProfileAuth,
} from '../lib/global-config'

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function runLogin(profileName?: string): Promise<void> {
  const profile = profileName ?? (await getActiveProfile())
  console.log(`\n[astrale] Authenticating for profile: ${profile}`)
  console.log(`\n  Note: WorkOS integration coming soon.`)
  console.log(`  For now, please enter your credentials manually.\n`)
  const avatarId = await prompt('  Avatar ID: ')
  const token = await prompt('  Token: ')
  if (!avatarId || !token) {
    console.error('\n✗ Avatar ID and token are required')
    process.exit(1)
  }
  await setProfileAuth(profile, { avatarId: avatarId as AvatarId, token })
  console.log(`\n✓ Authenticated for profile: ${profile}`)
}

async function runLogout(profileName?: string): Promise<void> {
  const profile = profileName ?? (await getActiveProfile())
  const auth = await getProfileAuth(profile)
  if (!auth) {
    console.log(`\n[astrale] Not authenticated for profile: ${profile}`)
    return
  }
  await clearProfileAuth(profile)
  console.log(`\n✓ Logged out from profile: ${profile}`)
}

async function runStatus(): Promise<void> {
  const profiles = await listProfiles()
  console.log(`\n  Profile       Status              Avatar`)
  console.log(`  ─────────────────────────────────────────────────`)
  for (const p of profiles) {
    const marker = p.isActive ? '*' : ' '
    const status = p.isAuthenticated ? 'authenticated' : 'not authenticated'
    const auth = p.isAuthenticated ? ((await getProfileAuth(p.name))?.avatarId ?? '') : ''
    const avatarShort = auth ? auth.slice(0, 20) + (auth.length > 20 ? '...' : '') : '-'
    console.log(`${marker} ${p.name.padEnd(12)} ${status.padEnd(18)} ${avatarShort}`)
  }
  console.log('')
}

export const authCommand = new Command('auth').description('Manage authentication')

authCommand.addCommand(
  new Command('login')
    .description('Authenticate with Astrale')
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
