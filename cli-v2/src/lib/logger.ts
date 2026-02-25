import chalk from 'chalk'

const PREFIX = chalk.blue('[astrale]')

export const log = {
  info: (...args: unknown[]) => console.log(PREFIX, ...args),
  success: (...args: unknown[]) => console.log(PREFIX, chalk.green('✓'), ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, chalk.yellow('⚠'), ...args),
  error: (...args: unknown[]) => console.error(PREFIX, chalk.red('✗'), ...args),
  blank: () => console.log(),
}
