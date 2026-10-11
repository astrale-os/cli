/** Copyable POSIX-shell command (PowerShell on Windows), preserving each argument literally. */
export function shellCommand(argv: readonly string[], platform = process.platform): string {
  return argv
    .map((value) => {
      if (/^[A-Za-z0-9_./:@%+=-]+$/.test(value) && !(platform === 'win32' && value.startsWith('@')))
        return value
      return platform === 'win32'
        ? `'${value.replaceAll("'", "''")}'`
        : `'${value.replaceAll("'", "'\"'\"'")}'`
    })
    .join(' ')
}
