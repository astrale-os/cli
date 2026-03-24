import { setActive, getInstance } from '../lib/instance'
import { log } from '../lib/log'

export async function useCommand(name: string): Promise<void> {
  try {
    await setActive(name)
    const entry = await getInstance(name)
    const detail = entry.url ? entry.url : 'local'
    log.success(`Active instance: ${name} (${detail})`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
