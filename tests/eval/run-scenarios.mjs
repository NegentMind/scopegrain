#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Standalone scenario runner / golden recorder for tests/eval.
//
//   node tests/eval/run-scenarios.mjs                 run all scenarios (process mode)
//   node tests/eval/run-scenarios.mjs --mode inproc   same steps through run()
//   node tests/eval/run-scenarios.mjs --mode both     both, plus parity diff
//   node tests/eval/run-scenarios.mjs --record        run + write fixtures/*.golden.json
//   node tests/eval/run-scenarios.mjs --replay        replay recorded goldens
//   node tests/eval/run-scenarios.mjs --scenario smoke --keep
//
// Exit code 0 = all expectations/diffs clean; 1 = any failure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  FIXTURES_DIR, hashStateTree, listFixtures, listScenarios,
  normalizedEnvelopes, replayFixture, runScenario,
} from './lib/driver.mjs';

const argv = process.argv.slice(2);
const opts = { mode: 'process', record: false, replay: false, keep: false,
  scenarios: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--record') opts.record = true;
  else if (a === '--replay') opts.replay = true;
  else if (a === '--keep') opts.keep = true;
  else if (a === '--mode') opts.mode = argv[++i];
  else if (a === '--scenario') opts.scenarios.push(argv[++i]);
  else if (a === '--help' || a === '-h') {
    process.stdout.write(`${fs.readFileSync(new URL(import.meta.url), 'utf8')
      .split('\n').slice(0, 15).join('\n')}\n`);
    process.exit(0);
  } else {
    process.stderr.write(`unknown flag: ${a}\n`);
    process.exit(2);
  }
}
if (!['process', 'inproc', 'both'].includes(opts.mode)) {
  process.stderr.write(`--mode must be process|inproc|both\n`);
  process.exit(2);
}

function reportFailures(label, failures) {
  for (const f of failures) {
    process.stderr.write(
      `  FAIL ${label} step ${f.step}: ${f.message}\n`
      + `       cmd: ${JSON.stringify(f.cmd)}\n`);
  }
}

async function runOne(entry, mode) {
  const run = await runScenario(entry.scenario, { mode });
  const status = run.failures.length === 0 ? 'ok' : 'FAIL';
  process.stdout.write(
    `[${status}] ${entry.name} (${mode}) ${run.steps.length} steps\n`);
  reportFailures(`${entry.name}/${mode}`, run.failures);
  return run;
}

let failures = 0;

if (opts.replay) {
  const fixtures = listFixtures()
    .filter((f) => opts.scenarios.length === 0
      || opts.scenarios.includes(f.name));
  if (fixtures.length === 0) {
    process.stderr.write('no golden fixtures found; record with --record\n');
    process.exit(2);
  }
  for (const entry of fixtures) {
    const diffs = await replayFixture(entry.fixture);
    if (diffs.length === 0) {
      process.stdout.write(`[ok] replay ${entry.name}\n`);
    } else {
      failures += diffs.length;
      process.stdout.write(`[FAIL] replay ${entry.name}\n`);
      for (const d of diffs) process.stderr.write(`  ${d}\n`);
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const scenarios = listScenarios()
  .filter((s) => opts.scenarios.length === 0
    || opts.scenarios.includes(s.name));
if (scenarios.length === 0) {
  process.stderr.write('no scenarios matched\n');
  process.exit(2);
}

const pkg = createRequire(import.meta.url)('../../package.json');

for (const entry of scenarios) {
  const processRun = await runOne(entry, 'process');
  let inprocRun = null;
  if (opts.mode === 'inproc' || opts.mode === 'both') {
    inprocRun = await runOne(entry, 'inproc');
    const a = normalizedEnvelopes(processRun);
    const b = normalizedEnvelopes(inprocRun);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures++;
      process.stderr.write(
        `  FAIL ${entry.name}: process/inproc envelopes diverge\n`);
    }
  }
  failures += processRun.failures.length
    + (inprocRun?.failures.length ?? 0);
  if (opts.record && processRun.failures.length === 0) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    const golden = {
      name: entry.name,
      description: entry.scenario.description ?? null,
      recorded: {
        node: process.version,
        platform: process.platform,
        scopegrain: pkg.version,
      },
      setup: entry.scenario.setup ?? {},
      steps: entry.scenario.steps,
      envelopes: normalizedEnvelopes(processRun),
      storeHash: hashStateTree(processRun.projectRoot),
    };
    const file = path.join(FIXTURES_DIR, `${entry.name}.golden.json`);
    fs.writeFileSync(file, `${JSON.stringify(golden, null, 2)}\n`);
    process.stdout.write(`  recorded ${path.relative(process.cwd(), file)}\n`);
  }
  if (opts.keep) {
    process.stdout.write(`  kept ${processRun.projectRoot}\n`);
  } else {
    processRun.cleanup();
    inprocRun?.cleanup();
  }
}

process.exit(failures === 0 ? 0 : 1);
