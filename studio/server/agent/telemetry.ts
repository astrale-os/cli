/**
 * Explicit telemetry session id for Studio-driven agents. Injected as
 * ASTRALE_SESSION into the harness child so every `astrale` call it makes
 * buckets into one surface-owned session per workspace per hour (hour scoping
 * keeps a post-analysis resume from reopening an analyzed session in the
 * common case). Consumed by the CLI's telemetry recorder.
 */
export function studioSessionId(workspaceKey: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}`
  const slug = workspaceKey.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40)
  return `studio-${slug}-${stamp}`
}
