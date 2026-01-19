import type { SpaceId } from '@astrale-os/kernel-core'
import chalk from 'chalk'
import { Command } from 'commander'
import { withKernelClient } from '../lib/cli-utils'
import { setActiveSpaceId } from '../lib/global-config'

async function runList(profileName?: string): Promise<void> {
  await withKernelClient({ profileName }, async ({ client, config }) => {
    const result = await client.listSpaces()
    const { spaces } = result
    if (!spaces || spaces.length === 0) {
      console.log(chalk.dim(`\n  No spaces found. Create one with: astrale space create <name>\n`))
      return
    }
    console.log(chalk.dim(`\n  Space ID                              Name`))
    console.log(
      chalk.dim(`  ─────────────────────────────────────────────────────────────────────────`),
    )
    for (const space of spaces) {
      const isActive = space.spaceId === config.activeSpaceId
      const marker = isActive ? chalk.cyan('*') : ' '
      console.log(`${marker} ${space.spaceId.padEnd(38)} ${space.name}`)
    }
    console.log('')
    if (!config.activeSpaceId) {
      console.log(chalk.yellow(`  No space selected. Run: astrale space select <space-id>\n`))
    }
  })
}

async function runSelect(spaceId: string, profileName?: string): Promise<void> {
  await withKernelClient({ profileName }, async ({ client, config }) => {
    const result = await client.listSpaces()
    const space = result.spaces?.find((s) => s.spaceId === spaceId)
    if (!space) {
      const available = result.spaces?.map((s) => s.spaceId).join(', ')
      throw new Error(`Space "${spaceId}" not found. Available: ${available || 'none'}`)
    }
    await setActiveSpaceId(config.profile, spaceId as SpaceId)
    console.log(chalk.green(`\n✓ Selected space: ${spaceId}`))
    console.log(chalk.dim(`  Name: ${space.name}\n`))
  })
}

async function runCreate(name: string, profileName?: string): Promise<void> {
  await withKernelClient({ profileName }, async ({ client, config }) => {
    console.log(chalk.dim(`\n[astrale] Creating space "${name}"...`))
    const result = await client.createSpace(name)
    console.log(chalk.green(`✓ Space created: ${result.spaceId}`))
    try {
      const avatar = await client.createAvatar(result.spaceId, config.displayName, true)
      console.log(chalk.green(`✓ Avatar created: ${avatar.avatarId}`))
    } catch (avatarErr) {
      console.log(
        chalk.yellow(
          `⚠ Space created but avatar creation failed: ${avatarErr instanceof Error ? avatarErr.message : avatarErr}`,
        ),
      )
      console.log(
        chalk.dim(`  You may need to create an avatar manually for space: ${result.spaceId}`),
      )
    }
    await setActiveSpaceId(config.profile, result.spaceId)
    console.log(chalk.dim(`  Auto-selected as active space\n`))
  })
}

export const spaceCommand = new Command('space').description('Manage spaces')

spaceCommand.addCommand(
  new Command('list')
    .description('List available spaces')
    .option('--profile <name>', 'Profile to use')
    .action(async (opts) => {
      try {
        await runList(opts.profile)
      } catch (err) {
        console.error('[astrale] Space list failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    }),
)

spaceCommand.addCommand(
  new Command('select')
    .argument('<space-id>', 'Space ID to select')
    .description('Set active space for profile')
    .option('--profile <name>', 'Profile to use')
    .action(async (spaceId, opts) => {
      try {
        await runSelect(spaceId, opts.profile)
      } catch (err) {
        console.error('[astrale] Space select failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    }),
)

spaceCommand.addCommand(
  new Command('create')
    .argument('<name>', 'Name for the new space')
    .description('Create a new space')
    .option('--profile <name>', 'Profile to use')
    .action(async (name, opts) => {
      try {
        await runCreate(name, opts.profile)
      } catch (err) {
        console.error('[astrale] Space create failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    }),
)
