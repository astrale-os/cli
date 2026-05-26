#!/usr/bin/env bun
import { buildProgram } from '../src/program'

const program = await buildProgram()
await program.parseAsync()
