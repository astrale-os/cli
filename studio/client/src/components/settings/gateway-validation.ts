import type { HarnessGatewayAuth } from '@shared/types'

export function validateGatewayDraft(
  enabled: boolean,
  baseUrl: string,
  mode: HarnessGatewayAuth['mode'],
  token: string,
): string | null {
  if (!enabled) return null
  const value = baseUrl.trim()
  if (!value) return 'Base URL is required while the custom gateway is enabled.'
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return 'Base URL must use http:// or https://.'
  } catch {
    return 'Base URL must be a valid URL.'
  }
  if (mode === 'token' && !token.trim()) return 'A static bearer token is required in token mode.'
  return null
}
