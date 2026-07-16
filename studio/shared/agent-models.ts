/** Update one harness-specific model override without disturbing sibling harnesses. */
export function updateAgentModel(
  current: Record<string, string>,
  harness: string,
  model: string,
): Record<string, string> {
  const key = harness.trim().toLowerCase()
  if (!key) return current
  const next = { ...current }
  const normalized = model.trim()
  if (normalized) next[key] = normalized
  else delete next[key]
  return next
}
