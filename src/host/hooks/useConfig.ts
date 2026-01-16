/**
 * Config Hook
 *
 * Loads the app configuration from the dev server.
 */

import { useEffect, useState } from 'react'

import type { AppConfig } from '../types'

export interface UseConfigResult {
  config: AppConfig | null
  loading: boolean
  error: string | null
}

export function useConfig(): UseConfigResult {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/config.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        setConfig(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(`Failed to load config: ${err.message}`)
        setLoading(false)
      })
  }, [])

  return { config, loading, error }
}
