import net from 'node:net'

/**
 * Loopback port helpers for launching local servers (e.g. `astrale studio`).
 *
 * We probe by ACTUALLY trying to bind, not by connecting — a connect-probe to
 * 127.0.0.1 is racy and can falsely pass on a half-open socket. Whatever port
 * the OS lets us bind is, by definition, free for us right now. We bind on the
 * loopback interface specifically (matching the studio's 127.0.0.1 bind) with
 * `exclusive: true` so the probe never "succeeds" on a port another process
 * holds via SO_REUSEADDR/REUSEPORT.
 */
const LOOPBACK = '127.0.0.1'

/** Resolves true if [port] can be bound on loopback right now, false otherwise. */
export function portFree(port: number, host = LOOPBACK): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen({ port, host, exclusive: true })
  })
}

/**
 * First free port in [start, start + span) on loopback, or null if the whole
 * window is taken. We deliberately scan a small band in the IANA Registered
 * range (well below the OS ephemeral range, which starts at 49152 on
 * macOS/BSD and 32768 on Linux) so a probe can't collide with a short-lived
 * outbound socket the OS hands out a microsecond later.
 */
export async function findFreePort(
  start: number,
  span = 20,
  host = LOOPBACK,
): Promise<number | null> {
  for (let p = start; p < start + span; p++) {
    if (await portFree(p, host)) return p
  }
  return null
}
