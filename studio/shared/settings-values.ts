export const STUDIO_NUMERIC_LIMITS = {
  introspectTimeoutMs: { min: 250, max: 300_000 },
  instancePollMs: { min: 1_000, max: 3_600_000 },
  updatesPollMs: { min: 10_000, max: 86_400_000 },
  viewProbeTimeoutMs: { min: 250, max: 120_000 },
} as const

export type NumericStudioSetting = keyof typeof STUDIO_NUMERIC_LIMITS

/** Parse one user/disk numeric setting without permitting destructive intervals. */
export function parseStudioNumericSetting(
  key: NumericStudioSetting,
  value: unknown,
): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  const { min, max } = STUDIO_NUMERIC_LIMITS[key]
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}
