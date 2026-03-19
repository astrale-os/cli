import chalk from 'chalk'
import { log } from '../lib/log'
import {
  readIdentities,
  createIdentity,
  deleteIdentity,
  setDefault,
  getDefault,
} from '../lib/identity'

export async function identityCreateCommand(
  name: string,
  opts: { subject?: string },
): Promise<void> {
  try {
    const identity = await createIdentity(name, opts.subject)
    log.success(`Created identity "${name}" (subject: ${identity.subject})`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

export async function identityListCommand(): Promise<void> {
  const store = await readIdentities()
  const names = Object.keys(store.identities)

  if (names.length === 0) {
    log.dim('  No identities. Run: astrale identity create <name>')
    return
  }

  for (const name of names) {
    const identity = store.identities[name]
    const isDefault = name === store.default
    const marker = isDefault ? chalk.green(' *') : ''
    const subject = identity.subject !== name
      ? chalk.dim(` (subject: ${identity.subject})`)
      : ''
    console.log(`  ${chalk.bold(name)}${subject}${marker}`)
  }
}

export async function identityUseCommand(name: string): Promise<void> {
  try {
    await setDefault(name)
    log.success(`Default identity set to "${name}"`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

export async function identityWhoamiCommand(): Promise<void> {
  try {
    const identity = await getDefault()
    console.log(`${chalk.bold(identity.name)} (subject: ${identity.subject})`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

export async function identityDeleteCommand(name: string): Promise<void> {
  try {
    await deleteIdentity(name)
    log.success(`Deleted identity "${name}"`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
