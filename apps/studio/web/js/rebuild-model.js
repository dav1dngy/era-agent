// Pure helpers for the Rebuild screens (no DOM, no framework): unit-tested in tests/studio-ui-model.test.js.

// Split a command-line style argument string into arguments: spaces separate, single/double quotes group, backslash escapes.
export function parseArgs(text) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === '\\' && i + 1 < s.length) {
      cur += s[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (quote) throw new Error('An opening quote has no closing quote.');
  if (started || cur) out.push(cur);
  return out;
}

export const formatArgs = (args) => (args ?? []).map((a) => (a === '' || /[\s"'\\]/.test(a) ? `"${a.replace(/(["\\])/g, '\\$1')}"` : a)).join(' ');

// Editor rows <-> the project's acceptance.behaviors. A row: { name, args (text), stdin, stdout, exit_code, capture }.
export function rowsFromBehaviors(behaviors = []) {
  return behaviors.map((b) => ({ name: b.name, args: formatArgs(b.args), stdin: b.stdin ?? '', stdout: b.expect?.stdout ?? '', exit_code: b.expect?.exit_code ?? 0, capture: b.capture === 'reference' }));
}

export function behaviorsFromRows(rows) {
  const names = new Set();
  return rows.filter((r) => r.name.trim() || r.args.trim() || r.stdout || r.capture).map((r, i) => {
    const name = r.name.trim() || `behavior-${i + 1}`;
    if (names.has(name)) throw new Error(`Two behaviors are named "${name}".`);
    names.add(name);
    let args;
    try {
      args = parseArgs(r.args);
    } catch (err) {
      throw new Error(`Behavior "${name}": ${err.message}`, { cause: err });
    }
    const code = Number(r.exit_code);
    if (!Number.isInteger(code) || code < 0 || code > 255) throw new Error(`Behavior "${name}": the exit code must be a whole number from 0 to 255.`);
    return r.capture ? { name, args, stdin: r.stdin || null, capture: 'reference' } : { name, args, stdin: r.stdin || null, expect: { stdout: r.stdout, exit_code: code } };
  });
}

const lines = (t) => String(t ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

// The whole rebuild form -> the body ERA's API understands. Throws a readable Error for invalid input.
export function rebuildPayload(f) {
  const threshold = f.visualThreshold === '' || f.visualThreshold === undefined ? null : Number(f.visualThreshold);
  if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.99)) throw new Error('The visual similarity threshold must be between 0.5 and 0.99.');
  return {
    reference: f.reference.trim(),
    destination: f.destination.trim(),
    authorization: f.authorization.trim(),
    task: f.task.trim(),
    commands: { run: f.run.trim() || null, test: lines(f.test) },
    acceptance: {
      criteria: lines(f.criteria),
      commands: [...lines(f.accept).map((command) => ({ command })), ...lines(f.acceptFail).map((command) => ({ command, baseline: 'fail' }))],
      behaviors: behaviorsFromRows(f.behaviors ?? []),
      visual: threshold === null ? null : { threshold },
    },
  };
}

export function formFromProject(p) {
  return {
    reference: p.reference ?? '',
    destination: p.destination ?? '',
    authorization: p.authorization ?? '',
    task: p.task ?? '',
    run: p.commands?.run ?? '',
    test: (p.commands?.test ?? []).join('\n'),
    criteria: (p.acceptance?.criteria ?? []).join('\n'),
    accept: (p.acceptance?.commands ?? []).filter((c) => c.baseline !== 'fail').map((c) => c.command).join('\n'),
    acceptFail: (p.acceptance?.commands ?? []).filter((c) => c.baseline === 'fail').map((c) => c.command).join('\n'),
    behaviors: rowsFromBehaviors(p.acceptance?.behaviors),
    visualThreshold: p.acceptance?.visual?.threshold ?? '',
  };
}

// One sentence the user can act on, from a preflight check list.
export function checklistSummary(checks) {
  const fail = checks.filter((c) => c.status === 'fail').length;
  const warn = checks.filter((c) => c.status === 'warn').length;
  if (fail) return { tone: 'bad', text: `${fail} thing${fail > 1 ? 's' : ''} must be fixed before this can start` };
  if (warn) return { tone: 'warn', text: `Ready, with ${warn} warning${warn > 1 ? 's' : ''}` };
  return { tone: 'ok', text: 'Ready to start' };
}
