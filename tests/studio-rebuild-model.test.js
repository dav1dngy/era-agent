// Pure model for the Rebuild screens (no DOM). Real behavior of the form <-> project conversion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { behaviorsFromRows, checklistSummary, formFromProject, formatArgs, parseArgs, rebuildPayload, rowsFromBehaviors } from '../apps/studio/web/js/rebuild-model.js';

test('arguments split like a shell: quotes group, backslashes escape, empty strings survive', () => {
  assert.deepEqual(parseArgs('alice "hello world" x\\ y \'\' z'), ['alice', 'hello world', 'x y', '', 'z']);
  assert.deepEqual(parseArgs('   '), []);
  assert.deepEqual(parseArgs('say "a \\"quoted\\" word"'), ['say', 'a "quoted" word']);
  assert.throws(() => parseArgs('open "never closed'), /closing quote/);
  for (const args of [['a b', '', "it's", 'x"y', 'plain'], []]) assert.deepEqual(parseArgs(formatArgs(args)), args, 'format → parse round-trips');
});

test('behavior rows become expectations the backend accepts, and back', () => {
  const rows = [{ name: 'greet', args: 'alice', stdin: '', stdout: 'Hello, alice!\n', exit_code: 0, capture: false }, { name: 'recorded', args: '"two words"', stdin: 'in', stdout: '', exit_code: 0, capture: true }, { name: '', args: '', stdin: '', stdout: '', exit_code: 0, capture: false }];
  const b = behaviorsFromRows(rows);
  assert.equal(b.length, 2, 'an empty row is ignored');
  assert.deepEqual(b[0], { name: 'greet', args: ['alice'], stdin: null, expect: { stdout: 'Hello, alice!\n', exit_code: 0 } });
  assert.deepEqual(b[1], { name: 'recorded', args: ['two words'], stdin: 'in', capture: 'reference' });
  assert.deepEqual(rowsFromBehaviors(b)[0], { name: 'greet', args: 'alice', stdin: '', stdout: 'Hello, alice!\n', exit_code: 0, capture: false });
  assert.throws(() => behaviorsFromRows([{ name: 'x', args: '', stdin: '', stdout: '', exit_code: 3000, capture: false }]), /exit code/);
  assert.throws(() => behaviorsFromRows([{ name: 'x', args: '"oops', stdin: '', stdout: '', exit_code: 0, capture: false }]), /closing quote/);
  assert.throws(() => behaviorsFromRows([{ name: 'dup', args: 'a', stdout: 'x', exit_code: 0 }, { name: 'dup', args: 'b', stdout: 'y', exit_code: 0 }]), /Two behaviors/);
});

test('the rebuild form produces the project fields it was loaded from (saving changes only what was edited)', () => {
  const project = { reference: '/r/app', destination: '/d/new', authorization: 'mine', task: 'Rebuild', commands: { run: 'node app.js', test: ['npm test'] }, acceptance: { criteria: ['Greets'], commands: [{ command: 'test -f a', baseline: 'any' }, { command: 'node t.js', baseline: 'fail' }], behaviors: [{ name: 'g', args: ['x'], stdin: null, expect: { stdout: 'hi\n', exit_code: 0 } }], visual: { threshold: 0.8 } } };
  const f = formFromProject(project);
  const out = rebuildPayload(f);
  assert.equal(out.reference, '/r/app');
  assert.deepEqual(out.commands, { run: 'node app.js', test: ['npm test'] });
  assert.deepEqual(out.acceptance.commands, [{ command: 'test -f a' }, { command: 'node t.js', baseline: 'fail' }]);
  assert.deepEqual(out.acceptance.behaviors[0].expect, { stdout: 'hi\n', exit_code: 0 });
  assert.deepEqual(out.acceptance.visual, { threshold: 0.8 });
  const edited = rebuildPayload({ ...f, reference: '  /r/other  ', run: '', visualThreshold: '' });
  assert.equal(edited.reference, '/r/other');
  assert.equal(edited.commands.run, null);
  assert.equal(edited.acceptance.visual, null);
  assert.throws(() => rebuildPayload({ ...f, visualThreshold: '0.2' }), /between 0.5 and 0.99/);
  assert.throws(() => rebuildPayload({ ...f, visualThreshold: 'abc' }), /between 0.5 and 0.99/);
});

test('the checklist summary says what must happen next', () => {
  assert.deepEqual(checklistSummary([{ status: 'pass' }, { status: 'fail' }, { status: 'fail' }]), { tone: 'bad', text: '2 things must be fixed before this can start' });
  assert.equal(checklistSummary([{ status: 'fail' }]).text, '1 thing must be fixed before this can start');
  assert.deepEqual(checklistSummary([{ status: 'pass' }, { status: 'warn' }]), { tone: 'warn', text: 'Ready, with 1 warning' });
  assert.deepEqual(checklistSummary([{ status: 'pass' }, { status: 'info' }]), { tone: 'ok', text: 'Ready to start' });
});
