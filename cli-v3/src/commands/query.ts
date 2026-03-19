import chalk from 'chalk'
import { KernelWSClient } from '@astrale-os/kernel-client-ws'
import { readConfig } from '../lib/config'
import { signAs } from '../lib/keys'
import { KEYS_DIR } from '../lib/paths'
import { log, spinner } from '../lib/log'
import { getDefault, getIdentity } from '../lib/identity'
import { highlightJson, formatElapsed } from '../lib/format'

const QUERY_METHOD = '/kernel.astrale.ai/Root/query'

type QueryOptions = {
  raw?: boolean
  json?: boolean
  kernel?: string
  timeout?: string
  as?: string
}

export async function queryCommand(cypher: string, opts: QueryOptions): Promise<void> {
  const isTTY = process.stdout.isTTY ?? false
  const isRaw = opts.raw || opts.json || !isTTY

  const config = await readConfig()
  const wsUrl = opts.kernel ?? `ws://localhost:${config.managerPort}/ws`

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

  const spin = !isRaw ? spinner('Running query...') : null
  const startTime = performance.now()

  try {
    await client.connect()
    const result = await client.call(QUERY_METHOD, { cypher }, credential)
    const elapsed = performance.now() - startTime

    await client.close()

    if (isRaw) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      spin?.succeed(`Query completed in ${chalk.dim(formatElapsed(elapsed))}`)
      console.log('')
      console.log(highlightJson(JSON.stringify(result, null, 2)))
    }
    process.exit(0)
  } catch (error) {
    await client.close().catch(() => {})

    if (!isRaw && spin) spin.fail('Query failed')

    if (error instanceof Error) {
      if (isRaw) {
        process.stderr.write(JSON.stringify({ error: error.name, message: error.message }) + '\n')
      } else {
        log.error(error.message)
      }
    } else {
      log.error(String(error))
    }
    process.exit(1)
  }
}
