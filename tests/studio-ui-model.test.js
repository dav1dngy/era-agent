import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipeline, progressPercent, simpleStatus, layoutGraph, approvalState, groupFindings } from '../apps/studio/web/js/model.js';
import { createRequire } from 'node:module';
const { trustedSender, sameOrigin } = createRequire(import.meta.url)('../apps/studio/electron/security.cjs');

test('Studio pipeline distinguishes executed, pending, interrupted and approval stages', () => {
  const run = { op: 'modify', status: 'interrupted', steps: { detect: { status: 'done', started_at: '2026-01-01' }, 'implement-1': { status: 'running', started_at: '2026-01-02' } } };
  const stages = buildPipeline({ run, roles: { implementer: 'custom:local', reviewer: 'custom:review' } });
  assert.equal(stages.find((s) => s.key === 'implement-1').state, 'stalled');
  assert.equal(stages.find((s) => s.key === 'review-1').state, 'pending');
  assert.equal(stages.at(-1).state, 'pending');
  assert.ok(progressPercent(stages) < 100);
  assert.equal(buildPipeline({ run: { op: 'modify', status: 'awaiting-approval' } }).at(-1).state, 'waiting');
  assert.equal(buildPipeline({ run: { op: 'review', status: 'complete' } }).some((s) => s.key === 'approval'), false);
  assert.deepEqual(buildPipeline({ run: null }), []);
});
test('Studio refuses UI approval unless the exact run awaits approval and verification passes', () => {
  for (const status of ['running', 'failed', 'rejected', 'applied', 'cancelled', 'interrupted']) assert.equal(approvalState({ run: { status }, finalize: { pass: true } }).allowed, false);
  assert.equal(approvalState({ run: { status: 'awaiting-approval' }, finalize: { pass: false } }).allowed, false);
  assert.equal(approvalState({ run: { status: 'awaiting-approval' }, finalize: { pass: true } }).allowed, true);
});
test('Studio summaries and graph layout do not manufacture successful evidence', () => {
  assert.equal(simpleStatus({ job: { status: 'queued' } }).text, 'Queued');
  assert.equal(simpleStatus({ project: { status: 'failed' } }).tone, 'bad');
  const graph = { nodes: [{ id: 'a', kind: 'module' }, { id: 'b', kind: 'external' }], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'missing' }] };
  const out = layoutGraph(graph);
  assert.equal(out.edges.length, 1);
  assert.deepEqual(layoutGraph(graph), out);
  assert.deepEqual(groupFindings([{ severity: 'low' }, { severity: 'critical' }]).map(([s]) => s), ['critical', 'low']);
});
test('Electron IPC refuses foreign contents, subframes, malformed URLs and lookalike origins', () => {
  const origin = 'http://127.0.0.1:1234';
  const frame = { url: origin + '/#/home' };
  const contents = { mainFrame: frame };
  assert.equal(trustedSender({ sender: contents, senderFrame: frame }, contents, origin), true);
  assert.equal(trustedSender({ sender: {}, senderFrame: frame }, contents, origin), false);
  assert.equal(trustedSender({ sender: contents, senderFrame: { url: frame.url } }, contents, origin), false);
  for (const url of ['file:///tmp/x', origin + '.evil.example/', 'http://localhost:1234/', 'http://127.0.0.1:9999', 'not a URL']) {
    assert.equal(sameOrigin(url, origin), false);
    frame.url = url;
    assert.equal(trustedSender({ sender: contents, senderFrame: frame }, contents, origin), false);
  }
});
