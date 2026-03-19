import chalk from 'chalk'
import { log } from '../lib/log'
import {
  readTargets,
  createTarget,
  deleteTarget,
  setDefaultTarget,
  getDefaultTarget,
} from '../lib/target'

export async function targetCreateCommand(
  name: string,
  opts: { url?: string; instance?: string },
): Promise<void> {
  try {
    const target = await createTarget(name, opts)
    if (target.url) {
      log.success(`Created target "${name}" (url: ${target.url})`)
    } else {
      log.success(`Created target "${name}" (instance: ${target.instance})`)
    }
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

export async function targetListCommand(): Promise<void> {
  const store = await readTargets()
  const names = Object.keys(store.targets)

  if (names.length === 0) {
    log.dim('  No targets. Run: astrale target create <name> --url <ws-url>')
    return
  }

  for (const name of names) {
    const target = store.targets[name]
    const isDefault = name === store.default
    const marker = isDefault ? chalk.green(' *') : ''
    const detail = target.url
      ? chalk.dim(` (${target.url})`)
      : chalk.dim(` (instance: ${target.instance})`)
    console.log(`  ${chalk.bold(name)}${detail}${marker}`)
  }
}

export async function targetUseCommand(name: string): Promise<void> {
  try {
    await setDefaultTarget(name)
    log.success(`Default target set to "${name}"`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

export async function targetWhoamiCommand(): Promise<void> {
  try {
    const target = await getDefaultTarget()
    const detail = target.url ?? `instance: ${target.instance}`
    console.log(`${chalk.bold(target.name)} (${detail})`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

export async function targetDeleteCommand(name: string): Promise<void> {
  try {
    await deleteTarget(name)
    log.success(`Deleted target "${name}"`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
