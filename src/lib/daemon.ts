import { writeFile, unlink, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { AstraleConfig } from './config'

import { ASTRALE_HOME, LOGS_DIR } from './paths'

const LAUNCHD_LABEL = 'ai.astrale.manager'
const SYSTEMD_UNIT = 'astrale-manager.service'

function launchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
}

function systemdUnitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT)
}

function astraleEntrypoint(): string {
  // Resolve the globally installed `astrale` binary
  return 'astrale'
}

// ─── macOS (launchd) ────────────────────────────────────────────

function buildPlist(config: AstraleConfig): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${astraleEntrypoint()}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(LOGS_DIR, 'manager.stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(LOGS_DIR, 'manager.stderr.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MANAGER_PORT</key>
    <string>${config.managerPort}</string>
    <key>MANAGER_STORE_DIR</key>
    <string>${ASTRALE_HOME}</string>
    <key>FALKORDB_PORT</key>
    <string>${config.falkorPort}</string>
    <key>MANAGER_GRAPH</key>
    <string>${config.graphName}</string>
    <key>UI_PORT</key>
    <string>${config.uiPort}</string>
  </dict>
</dict>
</plist>
`
}

// ─── Linux (systemd) ────────────────────────────────────────────

function buildUnit(config: AstraleConfig): string {
  return `[Unit]
Description=Astrale Manager Kernel
After=network.target docker.service

[Service]
Type=simple
ExecStart=${astraleEntrypoint()} start --foreground
Restart=always
RestartSec=3
Environment=MANAGER_PORT=${config.managerPort}
Environment=MANAGER_STORE_DIR=${ASTRALE_HOME}
Environment=FALKORDB_PORT=${config.falkorPort}
Environment=MANAGER_GRAPH=${config.graphName}
Environment=UI_PORT=${config.uiPort}

[Install]
WantedBy=default.target
`
}

// ─── Public API ─────────────────────────────────────────────────

export async function installDaemon(config: AstraleConfig): Promise<void> {
  await mkdir(LOGS_DIR, { recursive: true })

  if (process.platform === 'darwin') {
    const path = launchdPlistPath()
    await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
    await writeFile(path, buildPlist(config))
  } else {
    const path = systemdUnitPath()
    await mkdir(join(homedir(), '.config', 'systemd', 'user'), { recursive: true })
    await writeFile(path, buildUnit(config))
    await run(['systemctl', '--user', 'daemon-reload'])
    await run(['systemctl', '--user', 'enable', SYSTEMD_UNIT])
  }
}

export async function uninstallDaemon(): Promise<void> {
  try {
    await stopDaemon()
  } catch {
    // already stopped
  }

  if (process.platform === 'darwin') {
    await unlink(launchdPlistPath()).catch(() => {})
  } else {
    await run(['systemctl', '--user', 'disable', SYSTEMD_UNIT]).catch(() => {})
    await unlink(systemdUnitPath()).catch(() => {})
    await run(['systemctl', '--user', 'daemon-reload']).catch(() => {})
  }
}

export async function startDaemon(): Promise<void> {
  if (process.platform === 'darwin') {
    await run(['launchctl', 'load', launchdPlistPath()])
  } else {
    await run(['systemctl', '--user', 'start', SYSTEMD_UNIT])
  }
}

export async function stopDaemon(): Promise<void> {
  if (process.platform === 'darwin') {
    await run(['launchctl', 'unload', launchdPlistPath()])
  } else {
    await run(['systemctl', '--user', 'stop', SYSTEMD_UNIT])
  }
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      const output = await run(['launchctl', 'list', LAUNCHD_LABEL])
      return output.includes(LAUNCHD_LABEL)
    } else {
      const output = await run(['systemctl', '--user', 'is-active', SYSTEMD_UNIT])
      return output.trim() === 'active'
    }
  } catch {
    return false
  }
}

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Command failed: ${cmd.join(' ')}\n${stderr}`)
  }
  return stdout
}
