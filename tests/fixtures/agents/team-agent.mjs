// MOCK CODING AGENTS (test fixture) for the multi-agent workflow tests. One scripted program that plays different
// roles depending on argv[2]. They are NOT AI: they prove ERA's orchestration (roles, hand-offs, isolation, review loop),
// not the quality of any model. No model is called.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const mode = process.argv[2];
const phase = process.env.ERA_PHASE;
const readOnly = process.env.ERA_READ_ONLY === '1';
const prompt = readFileSync(process.env.ERA_INSTRUCTIONS_FILE, 'utf8');
const round = Number(/-(\d+)\.md$/.exec(basename(process.env.ERA_INSTRUCTIONS_FILE))?.[1] ?? 1);
const say = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v));
const finding = (over = {}) => ({ title: 'total() accepts negative quantities', severity: 'high', category: 'correctness', file: 'src/cart.js', line: 7, snippet: 'sum + item.price * (item.quantity ?? 1)', evidence: 'A negative quantity reduces the total below zero, so a customer could be credited for returning nothing.', detail: 'No input validation.', recommendation: 'Clamp the quantity to zero or more.', ...over });
const need = (cond, msg) => {
  if (!cond) {
    console.error(msg);
    process.exit(9);
  }
};

if (mode === 'architect') {
  need(readOnly && phase === 'architecture', 'the architect must run read-only in the architecture phase');
  say('Design follows.\n```json\n' + JSON.stringify({ summary: 'Multiply each line price by its quantity.', design: 'Change total() in src/cart.js to weigh each item by item.quantity (default 1), mirroring itemCount().', files: [{ path: 'src/cart.js', change: 'modify', why: 'total() ignores quantity' }, { path: '../../etc/passwd', change: 'modify', why: 'must be dropped' }], steps: ['Edit total()', 'Run the tests'], risks: ['Negative quantities'], acceptance_criteria: ['total([{price:2,quantity:3}]) === 6'], out_of_scope: ['Currency rounding'] }) + '\n```');
} else if (mode === 'implementer') {
  need(!readOnly, 'the implementer must not be read-only');
  const f = 'src/cart.js';
  let s = readFileSync(f, 'utf8');
  if (phase === 'implement') {
    s = s.replace('sum + item.price,', 'sum + item.price * (item.quantity ?? 1),').replace('// BUG: the quantity of each line item is ignored.\n', '');
  } else if (phase === 'correct') {
    need(/negative quantities/.test(prompt), 'the correction prompt must carry the reviewer finding');
    s = s.replace('sum + item.price * (item.quantity ?? 1)', 'sum + item.price * Math.max(0, item.quantity ?? 1)');
  }
  writeFileSync(f, s);
  say(`implementer done (${phase})`);
} else if (mode === 'implementer-flawed') {
  // Fixes the bug but ALSO adds an obviously dangerous function that no test covers (to give a real reviewer something to find).
  const f = 'src/cart.js';
  let s = readFileSync(f, 'utf8');
  if (phase === 'implement') {
    s = s.replace('sum + item.price,', 'sum + item.price * (item.quantity ?? 1),').replace('// BUG: the quantity of each line item is ignored.\n', '');
    s = s.replace('module.exports = { itemCount, total };', '// Applies a discount expression supplied by the shopper, e.g. "total * 0.9".\nfunction applyDiscount(total, expression) {\n  return eval(expression);\n}\n\nmodule.exports = { itemCount, total, applyDiscount };');
  } else {
    need(/eval/i.test(prompt), 'the correction prompt must carry the reviewer finding about eval');
    s = s.replace(/\/\/ Applies a discount[\s\S]*?\n}\n\n/, '').replace(', applyDiscount }', ' }');
  }
  writeFileSync(f, s);
  say(`flawed implementer done (${phase})`);
} else if (mode === 'implementer-breaks-on-correct') {
  const f = 'src/cart.js';
  let s = readFileSync(f, 'utf8');
  if (phase === 'implement') s = s.replace('sum + item.price,', 'sum + item.price * (item.quantity ?? 1),');
  else s = s.replace(/return items\.reduce\(\(sum, item\) => sum \+ item\.price \* \(item\.quantity \?\? 1\), 0\);/, 'return 0;');
  writeFileSync(f, s);
} else if (mode === 'reviewer-flag-once') {
  need(readOnly && phase === 'review', 'the reviewer must run read-only');
  say(round === 1 ? '```json\n' + JSON.stringify([finding()]) + '\n```' : '[]');
} else if (mode === 'reviewer-always') {
  need(readOnly, 'read-only');
  // Quotes code that no correction touches, so the finding stays verifiable in every round.
  say([finding({ title: 'itemCount() never validates quantities', line: 3, snippet: 'items.reduce((sum, item) => sum + (item.quantity ?? 1), 0)' })]);
} else if (mode === 'reviewer-clean') {
  need(readOnly, 'read-only');
  say('[]');
} else if (mode === 'reviewer-hallucinates') {
  need(readOnly, 'read-only');
  say([finding({ snippet: 'return fabricated(code)', title: 'Fabricated quote' }), finding({ file: 'src/nope.js', title: 'Invented file' })]);
} else if (mode === 'reviewer-prose') {
  say('Looks great to me, ship it!');
} else if (mode === 'reviewer-writes') {
  writeFileSync('INJECTED.txt', 'a reviewer must never write');
  say('[]');
} else if (mode === 'architect-writes') {
  writeFileSync('INJECTED.txt', 'an architect must never write');
  say('{}');
} else if (mode === 'dump') {
  // Reports what the agent can see, to test context and exposure limits.
  say({ cwdFiles: list('.'), phase, readOnly, promptHasDiff: /^diff --git/m.test(prompt), promptHasDesign: /Architecture design|DESIGN SUMMARY/.test(prompt) });
} else {
  console.error(`unknown mock mode ${mode}`);
  process.exit(2);
}

function list(dir) {
  return readdirSync(dir).flatMap((n) => (statSync(`${dir}/${n}`).isDirectory() ? list(`${dir}/${n}`) : [`${dir}/${n}`.replace(/^\.\//, '')])).sort();
}
