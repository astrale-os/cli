import { decodeJsonObject, runStudioCliJson, studioCliCommand } from '../cli'

function installedDomainArgs(origin: string, instance: string): string[] {
  return ['introspect', origin, '--bundle', '--json', '-i', instance]
}

export function installedDomainCommand(
  origin: string,
  instance: string,
  encodedDescriptor?: string,
): string[] {
  return studioCliCommand(installedDomainArgs(origin, instance), encodedDescriptor)
}

export type InstalledDomainProbe =
  | { state: 'installed'; bundle: unknown }
  | { state: 'not-installed' | 'unknown'; bundle: null }

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export function installedDomainProbeResult(
  stdout: string,
  stderr: string,
  exitCode: number,
): InstalledDomainProbe {
  const output = jsonObject(stdout)
  const diagnostic = jsonObject(stderr)
  const error = output?.error ?? diagnostic?.error
  if (
    error === 'DOMAIN_NOT_INSTALLED' ||
    error === 'NOT_FOUND' ||
    /\b(?:DOMAIN_NOT_INSTALLED|NOT_FOUND)\b/.test(`${stdout}\n${stderr}`)
  ) {
    return { state: 'not-installed', bundle: null }
  }

  if (exitCode === 0) {
    const bundle = output?.bundle
    if (
      bundle !== null &&
      typeof bundle === 'object' &&
      !Array.isArray(bundle) &&
      Object.prototype.hasOwnProperty.call(bundle, 'root')
    ) {
      return { state: 'installed', bundle }
    }
  }
  return { state: 'unknown', bundle: null }
}

export async function getInstalledDomain(
  origin: string,
  instance: string,
  timeoutMs = 8000,
): Promise<InstalledDomainProbe> {
  const result = await runStudioCliJson(installedDomainArgs(origin, instance), decodeJsonObject, {
    timeoutMs,
  })
  return installedDomainProbeResult(result.stdout, result.stderr, result.exitCode)
}
