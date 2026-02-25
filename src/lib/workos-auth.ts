import type { ProfileAuth } from './global-config'

export const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID || 'client_01KC29HET5F3QAQ8GNTPZ7F320'
const WORKOS_DEVICE_AUTH_URL = 'https://api.workos.com/user_management/authorize/device'
const WORKOS_TOKEN_URL = 'https://api.workos.com/user_management/authenticate'
const TOKEN_REFRESH_MARGIN_SECONDS = 60

export interface DeviceAuthorizationResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

export interface WorkOSUser {
  object: string
  id: string
  email: string
  email_verified: boolean
  first_name: string | null
  last_name: string | null
  profile_picture_url: string | null
  last_sign_in_at: string
  created_at: string
  updated_at: string
  external_id: string | null
}

export interface TokenResponse {
  user: WorkOSUser
  organization_id: string | null
  access_token: string
  refresh_token: string
  authentication_method: string
}

export interface WorkOSAuthenticated {
  userId: string
  accessToken: string
  refreshToken: string
  user: WorkOSUser
}

interface JwtPayload {
  exp: number
  iat: number
  sub: string
}

function decodeJwtPayload(token: string): JwtPayload {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Invalid JWT format (expected 3 parts)')
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8')
    return JSON.parse(payload) as JwtPayload
  } catch (error) {
    throw new Error(
      `Failed to decode JWT: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function isTokenExpired(
  accessToken: string,
  marginSeconds = TOKEN_REFRESH_MARGIN_SECONDS,
): boolean {
  try {
    const payload = decodeJwtPayload(accessToken)
    const now = Math.floor(Date.now() / 1000)
    return payload.exp - marginSeconds <= now
  } catch {
    return true
  }
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch(WORKOS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: WORKOS_CLIENT_ID,
    }),
  })
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to refresh token: ${error}`)
  }
  const data = (await response.json()) as TokenResponse
  return { accessToken: data.access_token, refreshToken: data.refresh_token }
}

export async function getValidAccessToken(
  auth: ProfileAuth,
  onRefresh: (newAuth: ProfileAuth) => Promise<void>,
): Promise<string> {
  if (!isTokenExpired(auth.accessToken)) {
    return auth.accessToken
  }
  const refreshed = await refreshAccessToken(auth.refreshToken)
  const newAuth: ProfileAuth = {
    ...auth,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
  }
  await onRefresh(newAuth)
  return refreshed.accessToken
}

export async function requestDeviceAuthorization(): Promise<DeviceAuthorizationResponse> {
  const response = await fetch(WORKOS_DEVICE_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: WORKOS_CLIENT_ID }),
  })
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to request device authorization: ${error}`)
  }
  return response.json() as Promise<DeviceAuthorizationResponse>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function pollForTokens(
  deviceCode: string,
  expiresIn = 300,
  interval = 5,
): Promise<TokenResponse> {
  const timeout = AbortSignal.timeout(expiresIn * 1000)
  let pollInterval = interval
  while (true) {
    const response = await (async () => {
      try {
        return await fetch(WORKOS_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: WORKOS_CLIENT_ID,
          }),
          signal: timeout,
        })
      } catch (error) {
        if ((error as Error).name === 'TimeoutError') throw new Error('Authorization timed out')
        throw error
      }
    })()
    const data = (await response.json()) as TokenResponse | { error: string }
    if (response.ok) return data as TokenResponse
    const errorData = data as { error: string }
    switch (errorData.error) {
      case 'authorization_pending':
        await sleep(pollInterval * 1000)
        break
      case 'slow_down':
        pollInterval += 1
        await sleep(pollInterval * 1000)
        break
      case 'access_denied':
        throw new Error('Authorization denied by user')
      case 'expired_token':
        throw new Error('Authorization code expired')
      default:
        throw new Error(`Authorization failed: ${errorData.error || 'Unknown error'}`)
    }
  }
}
