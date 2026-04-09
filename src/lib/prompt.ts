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
