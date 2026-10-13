#!/usr/bin/env node
// Test double for the REA CLI. Behaviour is selected by FAKE_REA_MODE.
const mode = process.env.FAKE_REA_MODE ?? 'ok';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('9.9.9-fake\n');
  process.exit(0);
}
process.stderr.write('{"rea_progress":{"phase":"fake","completed":0,"total":1,"message":"working","sequence":1}}\n');
if (mode === 'ok') {
  process.stdout.write(JSON.stringify({ evidence_id: 'ev_fake', operation: 'fake_op', subject: { digest: { sha256: 'abc' } }, args }));
} else if (mode === 'error') {
  process.stdout.write(JSON.stringify({ error: 'Analysis failed', code: 'provider_unavailable', message: 'The selected analysis provider is unavailable.' }));
  process.exit(1);
} else if (mode === 'garbage') {
  process.stdout.write('not json');
} else if (mode === 'hang') {
  setTimeout(() => {}, 60_000);
} else if (mode === 'warn') {
  process.stderr.write('deprecation: something\n');
  process.stdout.write(JSON.stringify({ evidence_id: 'ev_warn', operation: 'fake_op' }));
}
