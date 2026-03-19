import { KernelWSClient } from '@astrale-os/kernel-client-ws'
import { readConfig } from '../lib/config'
import { signAs } from '../lib/keys'
import { KEYS_DIR } from '../lib/paths'
import { log, spinner } from '../lib/log'
import { getDefault, getIdentity } from '../lib/identity'
import { output } from '../lib/output'
import { resolveWsUrl } from '../lib/target'

type GetOptions = {
  raw?: boolean
  json?: boolean
  remote?: string
  instance?: string
  timeout?: string
  as?: string
}

export async function getCommand(path: string, opts: GetOptions): Promise<void> {
  const isTTY = process.stdout.isTTY ?? false
  const isRaw = opts.raw || opts.json || !isTTY

  const config = await readConfig()
  const wsUrl = await resolveWsUrl(opts, config)

  let credential: string
  try {
    const identity = opts.as ? await getIdentity(opts.as) : await getDefault()
    credential = await signAs(identity.subject, KEYS_DIR, { issuer: config.issuer })
  } catch (e) {
    log.error(e instanceof Error ? e.message : 'No auth keys found. Run `astrale init` first.')
    process.exit(1)
  }

  const client = new KernelWSClient({
    wsUrl,
    autoConnect: false,
    reconnect: false,
    maxRetries: 0,
    requestTimeout: parseInt(opts.timeout ?? '30000', 10),
  })

  const spin = !isRaw ? spinner(`Getting ${path}...`) : null
  // target:method notation — kernel resolves node class and finds get()
  const targetPath = path.startsWith('@') ? path : path
  const method = `${targetPath}:get`

  try {
    await client.connect()
    const result = await client.call(method, {}, credential)
    await client.close()

    spin?.succeed(`Node ${path}`)
    if (!isRaw) console.log('')
    output(result, opts)
    process.exit(0)
  } catch (error) {
    await client.close().catch(() => {})
    if (!isRaw && spin) spin.fail('Failed')
    if (error instanceof Error) {
      if (isRaw) {
        process.stderr.write(JSON.stringify({ error: error.name, message: error.message }) + '\n')
      } else {
        log.error(error.message)
      }
    }
    process.exit(1)
  }
}
