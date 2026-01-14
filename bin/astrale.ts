#!/usr/bin/env npx tsx
/**
 * Astrale CLI
 *
 * Main entry point for the CLI.
 */

import { program } from "commander"

import { buildCommand } from "../src/commands/build"
import { createCommand } from "../src/commands/create"
import { devCommand } from "../src/commands/dev"
import { initCommand } from "../src/commands/init"
import { startCommand } from "../src/commands/start"

program
  .name("astrale")
  .description("Astrale CLI - build, develop, and deploy Astrale apps")
  .version("0.1.0")

program.addCommand(initCommand)
program.addCommand(devCommand)
program.addCommand(buildCommand)
program.addCommand(createCommand)
program.addCommand(startCommand)

program.parse()
