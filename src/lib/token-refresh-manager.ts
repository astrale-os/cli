import { getProfileAuth, setProfileAuth, type ProfileAuth } from './global-config'
import { isTokenExpired, refreshAccessToken } from './workos-auth'

const TOKEN_REFRESH_MARGIN_SECONDS = 120
const TOKEN_CHECK_INTERVAL_MS = 30000

export interface TokenRefreshManagerConfig {
  profileName: string
  onRefresh?: (newToken: string) => void
  onError?: (error: Error) => void
}

export class TokenRefreshManager {
  private profileName: string
  private currentAuth: ProfileAuth | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private refreshPromise: Promise<string> | null = null
  private onRefresh?: (newToken: string) => void
  private onError?: (error: Error) => void

  constructor(config: TokenRefreshManagerConfig) {
    this.profileName = config.profileName
    this.onRefresh = config.onRefresh
    this.onError = config.onError
  }

  async start(): Promise<string> {
    this.stop()
    this.currentAuth = await getProfileAuth(this.profileName)
    if (!this.currentAuth) {
      throw new Error(`Not authenticated for profile "${this.profileName}"`)
    }
    const token = await this.getToken()
    this.refreshTimer = setInterval(() => this.proactiveRefresh(), TOKEN_CHECK_INTERVAL_MS)
    return token
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  async getToken(): Promise<string> {
    if (!this.currentAuth) {
      throw new Error('TokenRefreshManager not started')
    }
    if (!isTokenExpired(this.currentAuth.accessToken, TOKEN_REFRESH_MARGIN_SECONDS)) {
      return this.currentAuth.accessToken
    }
    return this.refresh()
  }

  private async refresh(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }
    this.refreshPromise = this.doRefresh()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async doRefresh(): Promise<string> {
    if (!this.currentAuth) {
      throw new Error('No auth available')
    }
    const refreshed = await refreshAccessToken(this.currentAuth.refreshToken)
    const newAuth: ProfileAuth = {
      ...this.currentAuth,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
    }
    await setProfileAuth(this.profileName, newAuth)
    this.currentAuth = newAuth
    this.onRefresh?.(newAuth.accessToken)
    return newAuth.accessToken
  }

  private proactiveRefresh(): void {
    if (
      !this.currentAuth ||
      !isTokenExpired(this.currentAuth.accessToken, TOKEN_REFRESH_MARGIN_SECONDS)
    ) {
      return
    }
    this.refresh().catch((error) => {
      this.onError?.(error instanceof Error ? error : new Error(String(error)))
    })
  }
}
