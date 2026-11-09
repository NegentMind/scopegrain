#!/usr/bin/env node
import { run, defaultIO } from '../src/cli.mjs';

process.exitCode = await run(process.argv.slice(2), defaultIO());
