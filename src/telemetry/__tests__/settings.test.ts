import { describe, expect, test } from 'bun:test'

import { analyzerEnabled, telemetryEnabled } from '../settings'
import { useTelemetryHome } from './fixture'

const telemetry = useTelemetryHome()

describe('telemetry switches', () => {
  test('recording is on by default and the environment overrides the config', () => {
    expect(telemetryEnabled()).toBe(true)
    telemetry.configure({ enabled: false })
    expect(telemetryEnabled()).toBe(false)
    process.env.ASTRALE_TELEMETRY = ' ON '
    expect(telemetryEnabled()).toBe(true)
    process.env.ASTRALE_TELEMETRY = 'maybe'
    expect(telemetryEnabled()).toBe(false)
  })

  test('the analyzer needs its own opt-in', () => {
    telemetry.configure({ enabled: true })
    expect(analyzerEnabled()).toBe(false)
    telemetry.configure({ analyzerEnabled: true })
    expect(analyzerEnabled()).toBe(true)
    process.env.ASTRALE_TELEMETRY_ANALYZER = 'off'
    expect(analyzerEnabled()).toBe(false)
  })
})
