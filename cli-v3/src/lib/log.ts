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

export function spinner(text: string): Ora {
  return ora({ text, color: 'cyan' }).start()
}
