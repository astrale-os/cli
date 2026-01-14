/**
 * Project Context
 *
 * Handles loading project configuration and app definitions.
 */

import type { ApplicationId } from "@astrale-os/kernel-core";
import path from "path";

import { loadAppDefinition, loadAppFromDirectory, type LoadedApp } from "./app-loader";
import {
  type AstraleConfig,
  findProjectRoot,
  getConfigPath,
  loadConfigWithOverrides,
} from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectContext {
  projectRoot: string;
  config: AstraleConfig | null;
  app: LoadedApp | null;
}

export interface ConfigOverrides {
  appId?: ApplicationId;
  kernelUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Loading
// ─────────────────────────────────────────────────────────────────────────────

export interface LoadProjectOptions {
  /** Fail if no config found (default: true) */
  requireConfig?: boolean;
  /** Load app definition (default: false) */
  loadApp?: boolean;
  /** Config overrides from CLI */
  overrides?: ConfigOverrides;
  /** Custom path to app definition file */
  appPath?: string;
}

/**
 * Load project context from current directory.
 * Finds .astrale/config.json and optionally loads app definition.
 */
export async function loadProject(
  options: LoadProjectOptions = {},
): Promise<ProjectContext> {
  const { requireConfig = true, loadApp = false, overrides = {}, appPath } = options;

  const projectRoot = await findProjectRoot(process.cwd());

  if (!projectRoot && requireConfig) {
    console.error(
      `[sdk-worker] No .astrale/config.json found.\n` +
        `  Run with --no-deploy to skip kernel deployment, or run 'worker-init' first.`,
    );
    process.exit(1);
  }

  const ctx: ProjectContext = {
    projectRoot: projectRoot ?? process.cwd(),
    config: null,
    app: null,
  };

  if (projectRoot) {
    ctx.config = await loadConfigWithOverrides(projectRoot, overrides);
  }

  if (loadApp) {
    ctx.app = await loadAppDefinitionSafe(ctx.projectRoot, appPath);
  }

  return ctx;
}

/**
 * Load app definition with error handling
 */
async function loadAppDefinitionSafe(projectRoot: string, appPath?: string): Promise<LoadedApp> {
  try {
    if (appPath) {
      const fullPath = path.resolve(projectRoot, appPath);
      return await loadAppDefinition(fullPath);
    }
    return await loadAppFromDirectory(projectRoot);
  } catch (err) {
    console.error(
      `[sdk-worker] Failed to load app:`,
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Display Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function printProjectInfo(ctx: ProjectContext): void {
  if (!ctx.config) return;

  console.log(`[sdk-worker] Config: ${getConfigPath(ctx.projectRoot)}`);
  console.log(`  App ID:  ${ctx.config.appId}`);
  console.log(`  Kernel:  ${ctx.config.kernelUrl}`);

  if (ctx.app) {
    console.log(`  App:     ${ctx.app.name} (${ctx.app.slug})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path Utilities
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedPaths {
  entryPath: string;
  outPath: string;
  outFile: string;
}

export function resolvePaths(
  entry: string,
  outdir: string,
  outfile: string,
): ResolvedPaths {
  const entryPath = path.resolve(process.cwd(), entry);
  const outPath = path.resolve(process.cwd(), outdir);
  const outFile = path.join(outPath, outfile);
  return { entryPath, outPath, outFile };
}
