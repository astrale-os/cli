import chalk from 'chalk'

/**
 * Prompt the user for Y/N confirmation. Returns true if confirmed.
 * Returns false in non-TTY environments (use --yes to bypass).
 */
export async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false

  process.stdout.write(chalk.yellow(`${message} [y/N] `))
  const answer = await readLine()
  return answer.toLowerCase() === 'y'
}

/**
 * Prompt with a Y default — design §7.1 "Y/n" semantics. Returns true
 * unless the user explicitly types `n`.
 */
export async function confirmDefaultYes(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true

  process.stdout.write(chalk.yellow(`${message} [Y/n] `))
  const answer = await readLine()
  return answer.toLowerCase() !== 'n'
}

/**
 * Prompt the user to type a specific string to confirm a dangerous action.
 * Returns false in non-TTY environments (use --yes to bypass).
 */
export async function confirmWithInput(message: string, expected: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false

  process.stdout.write(chalk.yellow(`${message}\n`))
  process.stdout.write(chalk.yellow(`  Type "${expected}" to confirm: `))
  const answer = await readLine()
  return answer === expected
}

/** Prompt a passphrase without echoing. Fails in non-TTY unless env override. */
export async function readPassphrase(
  message: string,
  opts: { minLength?: number } = {},
): Promise<string> {
  const env = process.env.ASTRALE_PASSPHRASE
  if (env) return env
  if (!process.stdin.isTTY) {
    throw new Error('Passphrase required but no TTY. Pipe via ASTRALE_PASSPHRASE env var.')
  }
  // v1 note: passphrase echoes on interactive terminals. Pipe
  // ASTRALE_PASSPHRASE=... for scripted flows. Silent stdin with raw
  // mode is roadmap (requires terminal capabilities handling).
  process.stdout.write(chalk.yellow(message))
  const answer = await readLine()
  process.stdout.write('\n')
  if (opts.minLength && answer.length < opts.minLength) {
    throw new Error(`Passphrase too short (min ${opts.minLength} chars)`)
  }
  return answer
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.resume()

    const onData = (chunk: string) => {
      data += chunk
      if (data.includes('\n')) {
        cleanup()
        resolve(data.trim())
      }
    }

    const onEnd = () => {
      cleanup()
      resolve(data.trim())
    }

    const cleanup = () => {
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      process.stdin.pause()
    }

    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
  })
}
