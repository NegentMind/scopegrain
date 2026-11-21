#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { run, defaultIO } from '../src/cli.mjs';

process.exitCode = await run(process.argv.slice(2), defaultIO());
