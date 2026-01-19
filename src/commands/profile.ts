import { Command } from 'commander'
import { listProfiles, setActiveProfile } from '../lib/global-config'

async function runList(): Promise<void> {
  const profiles = await listProfiles()
  console.log(`\n  Profile       Kernel URL`)
  console.log(`  ─────────────────────────────────────────────────`)
  for (const p of profiles) {
    const marker = p.isActive ? '*' : ' '
    console.log(`${marker} ${p.name.padEnd(12)} ${p.config.kernelWsUrl}`)
  }
  console.log('')
}

async function runSet(name: string): Promise<void> {
  await setActiveProfile(name)
  console.log(`\n✓ Switched to profile: ${name}\n`)
}

export const profileCommand = new Command('profile').description('Manage profiles')

profileCommand.addCommand(
  new Command('list').description('List available profiles').action(async () => {
    try {
      await runList()
    } catch (err) {
      console.error('[astrale] Profile list failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }),
)

profileCommand.addCommand(
  new Command('set')
    .argument('<name>', 'Profile name (local or prod)')
    .description('Set active profile')
    .action(async (name) => {
      try {
        await runSet(name)
      } catch (err) {
        console.error('[astrale] Profile set failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    }),
)
