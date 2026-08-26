import { AstraleError } from '../../errors.js'

/** Admit exact HTTPS origins explicitly granted by the CLI operator. */
export function admitExternalOpenOrigins(input: readonly string[] | undefined): readonly string[] {
  if (input === undefined) return Object.freeze([])
  const admitted = new Set<string>()
  for (const candidate of input) {
    let url: URL
    try {
      url = new URL(candidate)
    } catch (cause) {
      throw invalidExternalOrigin(candidate, cause)
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname.includes('*') ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw invalidExternalOrigin(candidate)
    }
    admitted.add(url.origin)
  }
  return Object.freeze([...admitted])
}

function invalidExternalOrigin(candidate: string, cause?: unknown): AstraleError {
  return new AstraleError(
    'INVALID_EXTERNAL_ORIGIN',
    `External navigation grant "${candidate}" is not an exact HTTPS origin.`,
    'Pass an origin such as https://connect.example.com with no credentials, path, query, or fragment.',
    cause === undefined ? undefined : { cause },
  )
}
