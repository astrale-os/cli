/** Refuse anything but a plain domain origin before it is spliced into a graph path. */
export function assertOrigin(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(value)) throw new Error(`Invalid domain origin: ${value}`)
  return value
}
