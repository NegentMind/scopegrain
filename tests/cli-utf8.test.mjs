// JSON input encoding contracts. Source stays ASCII; Unicode is test data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { createConfig } from '../src/core/config.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { VALID_ANSWERS, cleanup, fakeIO, makeTempDir, writeJson }
  from './helpers.mjs';

const AREA = '01234567-89ab-4cde-8fab-0123456789ab';
const TOKEN = 'ENCODING_TEST_TOKEN';
const INVALID = [
  ['ff byte', [0xff]],
  ['lone continuation', [0x80]],
  ['truncated multibyte', [0xe2, 0x82]],
  ['overlong encoding', [0xc0, 0xaf]],
  ['UTF8-encoded surrogate', [0xed, 0xa0, 0x80]],
];
const specInput = (originalRequest = TOKEN) => ({
  originalRequest, title: 'UTF8 CLI specification',
  outcome: { statement: 'Preserve exact text', evidencePlan: 'Byte and data checks' },
  requirements: [{ id: 'R1', statement: 'Reject only invalid encoding',
    scenarios: [{ id: 'S1', given: 'JSON bytes', when: 'read by CLI',
      then: 'text is either exact or rejected' }] }],
  scope: ['src/settings'], constraints: [], nonGoals: [], openQuestions: [],
});

function fixture() {
  const dir = makeTempDir('cli-utf8-legacy');
  const answers = { ...VALID_ANSWERS,
    paths: { ...VALID_ANSWERS.paths, plans: '.scopegrain/plans',
      state: '.scopegrain/state', memory: '.scopegrain/memory' } };
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, answers, {}));
  return dir;
}

// Include directories, links and exact file bytes without following links.
function tree(root) {
  const out = {};
  function visit(dir, prefix = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs);
      out[rel] = st.isSymbolicLink() ? { link: fs.readlinkSync(abs) }
        : st.isDirectory() ? 'directory' : fs.readFileSync(abs);
      if (st.isDirectory() && !st.isSymbolicLink()) visit(abs, rel);
    }
  }
  visit(root);
  return out;
}

function corrupt(value, bytes) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8');
  const token = Buffer.from(TOKEN);
  const start = encoded.indexOf(token);
  assert.notEqual(start, -1);
  assert.equal(encoded.indexOf(token, start + token.length), -1);
  const result = Buffer.concat([encoded.subarray(0, start), Buffer.from(bytes),
    encoded.subarray(start + token.length)]);
  assert.ok(result.length < loadLimits().maxDocumentBytes);
  // Corruption is inside a JSON string, not a separate syntax error.
  assert.doesNotThrow(() => JSON.parse(result.toString('utf8')));
  return result;
}

async function call(args, expected = 0) {
  const io = fakeIO();
  const code = await run(args, io);
  assert.equal(code, expected, JSON.stringify({ args, ...io.out }));
  assert.deepEqual(io.out.asked, []);
  if (expected === 0) {
    assert.deepEqual(io.out.stderr, []);
    assert.equal(io.out.stdout.length, 1);
    return JSON.parse(io.out.stdout[0]);
  }
  assert.deepEqual(io.out.stdout, []);
  assert.equal(io.out.stderr.length, 1);
  const payload = JSON.parse(io.out.stderr[0]);
  assert.deepEqual(Object.keys(payload), ['error']);
  return payload.error;
}

async function rejectReadonly(dir, argv, expected, message) {
  const before = tree(dir);
  try {
    const e = await call(argv, 1);
    assert.equal(e.code, expected);
    if (message) assert.equal(e.message, message);
  } finally { assert.deepEqual(tree(dir), before); }
}

for (const apply of [false, true]) {
  test(`invalid capture UTF8 is MALFORMED_JSON before missing context (apply=${apply})`, async () => {
    const dir = makeTempDir('cli-utf8-capture-before-context');
    try {
      const file = path.join(dir, 'capture.json');
      fs.writeFileSync(file, corrupt({ category: 'event', title: 'Capture',
        summary: TOKEN, areaIds: [AREA] }, [0xff]));
      await rejectReadonly(dir,
        ['capture', 'create', '--project', dir, '--input', file,
          ...(apply ? ['--apply'] : [])], 'MALFORMED_JSON',
        `malformed JSON in capture input: ${file}`);
    } finally { cleanup(dir); }
  });
}

for (const [label, bytes] of INVALID) {
  for (const apply of [false, true]) {
    test(`legacy specification rejects ${label} inside originalRequest (apply=${apply})`, async () => {
      const dir = fixture();
      try {
        const file = path.join(dir, 'specification.json');
        fs.writeFileSync(file, corrupt(specInput(), bytes));
        await rejectReadonly(dir,
          ['specification', 'create', '--project', dir, '--input', file,
            ...(apply ? ['--apply'] : [])], 'MALFORMED_JSON',
          `malformed JSON in specification input: ${file}`);
      } finally { cleanup(dir); }
    });
  }
}

test('valid replacement char, combining/precomposed accents, emoji and CRLF survive legacy apply/show exactly', async () => {
  const dir = fixture();
  try {
    const text = 'literal \ufffd | combining e\u0301 | precomposed \u00e9 | emoji \ud83d\ude80\r\nnext line';
    const dto = specInput(text);
    // Escaped lone surrogates are valid JSON and must not be blanket-banned.
    dto.constraints = ['escaped high \ud800', 'escaped low \udfff'];
    const file = path.join(dir, 'valid-unicode.json');
    const encoded = Buffer.from(JSON.stringify(dto, null, 2).replace(/\n/g, '\r\n') + '\r\n');
    assert.ok(encoded.includes(Buffer.from([0xef, 0xbf, 0xbd])));
    assert.ok(encoded.includes(Buffer.from([0xf0, 0x9f, 0x9a, 0x80])));
    fs.writeFileSync(file, encoded);
    const created = await call(['specification', 'create', '--project', dir,
      '--input', file, '--apply']);
    assert.equal(created.applied, true);
    assert.equal(created.artifact.data.originalRequest, text);
    assert.deepEqual(created.artifact.data.constraints, dto.constraints);
    const stored = JSON.parse(fs.readFileSync(path.join(dir,
      '.scopegrain/plans/specs', `${created.artifact.id}.json`), 'utf8'));
    assert.deepEqual(stored, created.artifact);
    assert.equal(stored.data.originalRequest, text);
    const before = tree(dir);
    const shown = await call(['specification', 'show', created.artifact.id,
      '--project', dir]);
    assert.deepEqual(tree(dir), before);
    assert.deepEqual(shown, created.artifact);
    assert.equal(shown.data.originalRequest, text);
    assert.deepEqual(fs.readFileSync(file), encoded);
    assert.equal(fs.existsSync(path.join(dir, '.scopegrain/state/workspace.json')), false);
    assert.equal(fs.existsSync(path.join(dir, '.scopegrain/state/journal')), false);
  } finally { cleanup(dir); }
});

for (const family of ['capture', 'specification']) {
  for (const apply of [false, true]) {
    test(`oversized invalid ${family} bytes prefer INPUT_TOO_LARGE (apply=${apply})`, async () => {
      const dir = family === 'capture'
        ? makeTempDir('cli-utf8-oversized-capture') : fixture();
      try {
        const file = path.join(dir, 'oversized.json');
        fs.writeFileSync(file, Buffer.alloc(loadLimits().maxDocumentBytes + 1, 0xff));
        await rejectReadonly(dir,
          [family, 'create', '--project', dir, '--input', file,
            ...(apply ? ['--apply'] : [])], 'INPUT_TOO_LARGE');
      } finally { cleanup(dir); }
    });
  }
}

for (const [label, encode] of [
  ['malformed ASCII', () => Buffer.from('{"originalRequest":')],
  ['UTF8 BOM', (value) => Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(value)),
  ])],
]) {
  for (const family of ['capture', 'specification']) {
    for (const apply of [false, true]) {
      test(`${family} ${label} remains MALFORMED_JSON (apply=${apply})`, async () => {
        const dir = family === 'capture'
          ? makeTempDir('cli-utf8-malformed-capture') : fixture();
        try {
          const file = path.join(dir, 'malformed.json');
          const value = family === 'capture'
            ? { category: 'event', title: 'Capture', summary: 'Text', areaIds: [AREA] }
            : specInput('Valid request');
          fs.writeFileSync(file, encode(value));
          await rejectReadonly(dir,
            [family, 'create', '--project', dir, '--input', file,
              ...(apply ? ['--apply'] : [])], 'MALFORMED_JSON',
            `malformed JSON in ${family} input: ${file}`);
        } finally { cleanup(dir); }
      });
    }
  }
}
