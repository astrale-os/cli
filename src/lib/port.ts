import net from 'node:net'

/**
 * Loopback port helpers for launching local servers (e.g. `astrale studio`).
 *
 * A port is free only when BOTH probes agree:
 *
 * 1. We can ACTUALLY bind it on the loopback interface (matching the studio's
 *    127.0.0.1 bind). Whatever the OS lets us bind is free for us right now.
 * 2. Nothing ANSWERS a connection on it, over IPv4 or IPv6 loopback. The bind
 *    probe alone misses listeners the studio would not collide with but the
 *    printed `http://localhost:<port>` URL still reaches: on macOS/BSD a
 *    127.0.0.1 bind succeeds next to another process's wildcard (`*`, `::`)
 *    listener, and nowhere does it see a listener bound to `::1` only (Vite's
 *    default `localhost`). The browser then resolves `localhost` to ::1 and
 *    lands on that other server instead of the studio.
 */
const LOOPBACK = '127.0.0.1'
const LOOPBACK_V6 = '::1'
const CONNECT_TIMEOUT_MS = 500

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen({ port, host, exclusive: true })
  })
}

/**
 * Resolves true if something accepts a TCP connection on [host]:[port].
 * A refusal, or a host this machine cannot reach (IPv6 disabled), means no.
 * A loopback connect never hangs without a listener, so a timeout counts as
 * busy (a listener whose accept backlog is full).
 */
export function portAnswers(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const settle = (answered: boolean) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(answered)
    }
    const timer = setTimeout(() => settle(true), CONNECT_TIMEOUT_MS)
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })
}

/** Resolves true if [port] can be bound on [host] and no loopback listener answers on it. */
export async function portFree(port: number, host = LOOPBACK): Promise<boolean> {
  if (!(await canBind(port, host))) return false
  const answers = await Promise.all([portAnswers(port, LOOPBACK), portAnswers(port, LOOPBACK_V6)])
  return !answers.some(Boolean)
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
