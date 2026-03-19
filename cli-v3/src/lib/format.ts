import chalk from 'chalk'

export function highlightJson(json: string): string {
  return json
    .replace(/"([^"]+)"(?=\s*:)/g, (_, key) => chalk.cyan(`"${key}"`))
    .replace(/: "([^"]*)"(?=[,\n\r\]}])/g, (_, val) => `: ${chalk.green(`"${val}"`)}`)
    .replace(/: (-?\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, (_, num) => `: ${chalk.yellow(num)}`)
    .replace(/: (true|false)\b/g, (_, bool) => `: ${chalk.magenta(bool)}`)
    .replace(/: (null)\b/g, (_, n) => `: ${chalk.dim(n)}`)
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}
