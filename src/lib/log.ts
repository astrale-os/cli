import chalk from 'chalk'
import ora, { type Ora } from 'ora'

export const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✔'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.error(chalk.red('✖'), msg),
  step: (msg: string) => console.log(chalk.cyan('→'), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
}

/**
 * Maximum cumulative bytes the spinner may write before its output is
 * silently dropped. Prevents unbounded memory growth when the output
 * stream backs up.
 */
const SPINNER_MAX_BYTES = 256 * 1024

/** Maximum time a spinner may run before being forcefully stopped. */
const SPINNER_SAFETY_MS = 60_000

/**
 * Wrap a WriteStream so that `write()` calls are counted and silently
 * dropped once a byte cap is exceeded.
 */
function cappedStream(target: NodeJS.WriteStream, maxBytes: number): NodeJS.WriteStream {
  let totalBytes = 0
  let killed = false

  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === 'write') {
        return function write(
          chunk: string | Uint8Array,
          encodingOrCb?: BufferEncoding | ((err?: Error) => void),
          cb?: (err?: Error) => void,
        ): boolean {
          if (killed) {
            // Invoke callback so callers waiting on drain don't hang.
            const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb
            if (callback) callback()
            return true
          }

          const len =
            typeof chunk === 'string'
              ? Buffer.byteLength(chunk, typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8')
              : chunk.length
          totalBytes += len

          if (totalBytes > maxBytes) {
            killed = true
            const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb
            if (callback) callback()
            return true
          }

          return obj.write(
            chunk,
            encodingOrCb as BufferEncoding,
            cb as ((err?: Error | null) => void) | undefined,
          )
        }
      }

      const value = Reflect.get(obj, prop, receiver)
      if (typeof value === 'function') return value.bind(obj)
      return value
    },
  })
}

export function spinner(text: string): Ora {
  const target = process.stderr

  if (!target.writable) {
    return ora({ text, isEnabled: false })
  }

  const stream = cappedStream(target, SPINNER_MAX_BYTES)
  const spin = ora({ text, color: 'cyan', stream }).start()

  const safety = setTimeout(() => {
    if (spin.isSpinning) spin.stop()
  }, SPINNER_SAFETY_MS)
  safety.unref()

  const onTargetError = () => {
    if (spin.isSpinning) spin.stop()
  }
  target.once('error', onTargetError)

  const cleanup = () => {
    clearTimeout(safety)
    target.removeListener('error', onTargetError)
  }

  const origSucceed = spin.succeed.bind(spin)
  const origFail = spin.fail.bind(spin)
  const origStop = spin.stop.bind(spin)

  spin.succeed = (text?: string) => {
    cleanup()
    return origSucceed(text)
  }
  spin.fail = (text?: string) => {
    cleanup()
    return origFail(text)
  }
  spin.stop = () => {
    cleanup()
    return origStop()
  }

  return spin
}
