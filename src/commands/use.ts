import { getActive, setActive, getInstance } from '../lib/instance'
import { log } from '../lib/log'

export async function useCommand(name?: string): Promise<void> {
  try {
    if (!name) {
      const active = await getActive()
      const detail = active.url ?? 'local'
      console.log(`${active.name} (${detail})`)
      return
    }
    await setActive(name)
    const entry = await getInstance(name)
    const detail = entry.url ? entry.url : 'local'
    log.success(`Active instance: ${name} (${detail})`)
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
