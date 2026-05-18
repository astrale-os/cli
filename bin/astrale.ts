#!/usr/bin/env bun
import { buildProgram } from '../src/program'

const program = await buildProgram()
program.parse()
