import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectTarget } from '../src/analysis/detect.js';
import { extractFacts, groupFacts } from '../src/analysis/facts.js';
import { planWorkflow, decompileCandidates } from '../src/analysis/analyze.js';
import { renderAnalysisReport } from '../src/analysis/report.js';
import { DATASETS, loadEvidence, tempDir } from './helpers.js';

test('detectTarget classifies fixtures', () => {
  assert.equal(detectTarget(join(DATASETS, 'native-hello', 'hello')).kind, 'mach-o');
  assert.equal(detectTarget(join(DATASETS, 'js-app')).kind, 'javascript-app');
  assert.equal(detectTarget(join(DATASETS, 'archive', 'js-app.zip')).kind, 'archive');
  assert.equal(detectTarget(join(DATASETS, 'esm-app', 'index.mjs')).kind, 'javascript-file');
});

test('detectTarget reports unsupported and unknown formats', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'elf'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]));
  writeFileSync(join(dir, 'blob.bin'), 'hello world');
  writeFileSync(join(dir, 'Foo.class'), Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52]));
  mkdirSync(join(dir, 'empty'));
  mkdirSync(join(dir, 'My.app'));
  assert.deepEqual([detectTarget(join(dir, 'elf')).kind, detectTarget(join(dir, 'elf')).supported], ['elf', false]);
  assert.equal(detectTarget(join(dir, 'blob.bin')).kind, 'unknown');
  assert.equal(detectTarget(join(dir, 'Foo.class')).kind, 'unknown');
  assert.equal(detectTarget(join(dir, 'empty')).supported, false);
  assert.equal(detectTarget(join(dir, 'My.app')).kind, 'macos-app-bundle');
});

test('planWorkflow maps kinds to REA commands', () => {
  assert.equal(planWorkflow('javascript-app', '/a')[0].subcommand, 'analyze-javascript-application');
  assert.equal(planWorkflow('archive', '/a')[0].subcommand, 'inspect-artifact');
  assert.deepEqual(planWorkflow('mach-o', '/a').map((s) => s.subcommand), ['inspect-macho']);
  assert.deepEqual(planWorkflow('mach-o', '/a', { runtime: true, scenarioPath: '/s.json' }).map((s) => s.subcommand), ['inspect-macho', 'capture-process']);
  assert.deepEqual(planWorkflow('elf', '/a'), []);
});

test('extractFacts reads real REA JavaScript application Evidence', () => {
  const facts = extractFacts(loadEvidence('js-app.analyze.json'));
  for (const f of ['module:src/main.js', 'entry:src/main.js', 'import:src/main.js->src/config.js', 'external:https', 'endpoint:https://status.example.test/api/v1/health']) {
    assert.ok(facts.includes(f), f);
  }
});

test('extractFacts reads real REA Mach-O, artifact and process Evidence', () => {
  assert.deepEqual(extractFacts(loadEvidence('hello.inspect-macho.json')), ['arch:arm64', 'dependency:/usr/lib/dyld', 'dependency:/usr/lib/libSystem.B.dylib', 'export:__mh_execute_header', 'export:_greet', 'export:_main', 'import:_printf', 'import:_strlen']);
  assert.ok(extractFacts(loadEvidence('js-app-zip.inspect-artifact.json')).includes('member:js-app/src/net.js'));
  assert.deepEqual(extractFacts(loadEvidence('hello.capture-process.json')), ['exit:0']);
  assert.deepEqual(extractFacts({ operation: 'other' }), []);
});

test('extractFacts reads real REA Hopper function Evidence', () => {
  assert.deepEqual(extractFacts(loadEvidence('hello.function-greet.json')), ['call:_greet->_printf', 'call:_greet->_strlen', 'function:_greet', 'string:Hello, %s! checksum=%u\\n']);
});

test('decompileCandidates skips the Mach-O header symbol and respects the limit', () => {
  const ev = loadEvidence('hello.inspect-macho.json');
  assert.deepEqual(decompileCandidates(ev, 8), ['_greet', '_main']);
  assert.deepEqual(decompileCandidates(ev, 1), ['_greet']);
});

test('groupFacts and report rendering', () => {
  const groups = groupFacts(['module:a.js', 'module:b.js', 'external:https']);
  assert.deepEqual(groups, { module: ['a.js', 'b.js'], external: ['https'] });
  const md = renderAnalysisReport({
    analysis_id: 'a1', target: { path: '/x/app', kind: 'javascript-app', detection: 'dir' }, engine: { version: '6.4.0' }, status: 'succeeded',
    runs: [{ label: 'g', command: ['rea', 'analyze-javascript-application', '/x/app'], status: 'succeeded', duration_ms: 5, evidence_id: 'ev_123456789012345678901234', errors: [] }],
    evidence: [{ operation: 'analyze_javascript_application', provider: 'p', coverage: 'complete', unknowns: 2, limitations: ['L1'] }],
    fact_groups: groups,
  });
  assert.match(md, /Source modules \(2\)/);
  assert.match(md, /`rea analyze-javascript-application \/x\/app`/);
  assert.match(md, /2 residual unknowns/);
});
