// SPDX-License-Identifier: Apache-2.0
// Kill-9 durability worker. Standalone child process: binds to an
// already workspace-enrolled project and runs N journaled creations,
// announcing each outcome on stdout BEFORE starting the next operation:
//   READY                        -> workspace bound, first op starting
//   DONE  <operationId> <rel>    -> operation committed AND confirmed
//   PENDING <operationId> <rel>  -> apply returned unconfirmed
//   ALLDONE                      -> loop finished, clean exit
// The parent test kills this process with SIGKILL at a random point and
// then verifies that every DONE operation is durable and no un-announced
// operation materialized partially.
import { resolveContext } from '../../../src/core/context.mjs';
import { applyJournaledCreation } from '../../../src/core/journal.mjs';
import { bindWorkspace, getWorkspace } from '../../../src/core/workspaces.mjs';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v !== undefined && !v.startsWith('--') ? v : fallback;
};

const project = flag('--project', null);
const config = flag('--config', '.scopegrain/config.json');
const ops = Number(flag('--ops', '20'));

if (!project) {
  process.stderr.write('kill9-journal-child: --project is required\n');
  process.exit(2);
}

const ctx = resolveContext({ project, config });
const workspace = getWorkspace(ctx);
const areaIds = workspace.areas.map((area) => area.id);
const bound = bindWorkspace(ctx, { areaIds });

process.stdout.write('READY\n');

for (let i = 0; i < ops; i += 1) {
  const rel = `kill9/records/rec-${i}.json`;
  const content = `${JSON.stringify({ i, recordId: `kill9-${i}`, pad: 'x'.repeat(64) })}\n`;
  try {
    const result = applyJournaledCreation(bound, [{
      sourceKind: 'task',
      recordId: `kill9-${i}`,
      sourceRevision: 0,
      areaIds: [...areaIds],
      file: { rel, content },
    }]);
    if (result.status === 'committed' && result.journalState === 'confirmed') {
      process.stdout.write(`DONE ${result.operationId} ${rel}\n`);
    } else {
      // Unconfirmed-but-consistent: the operation exists in the journal
      // in a recoverable state. The parent treats it like a DONE target.
      process.stdout.write(`PENDING ${result.operationId} ${rel}\n`);
    }
  } catch (e) {
    process.stdout.write(`FAILED ${e.code ?? 'INTERNAL'} ${rel}\n`);
  }
}
process.stdout.write('ALLDONE\n');
