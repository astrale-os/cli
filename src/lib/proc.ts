/**
 * Small cross-cutting process helpers. Lives in `lib/` (not in an adapter)
 * so both `lib/*` (e.g. dev-lock, tunnel-process) and `adapters/*` (the
 * Cloudflare domain-platform reaper) share one hardened implementation.
 */

/**
 * `process.kill(pid, 0)` liveness probe — true iff the process exists and
 * we can signal it.
 *
 * The `pid <= 0` guard is load-bearing: `process.kill(0, 0)` does NOT probe
 * a process — signal 0 to pid 0 targets the *caller's own* process group and
 * returns success, so a stray `pid: 0` (e.g. a never-resolved listener PID
 * persisted in dev state) would otherwise read as "alive" forever. Negative
 * pids are process groups — also not what callers mean here.
 */
export function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
