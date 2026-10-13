// Secret detection and redaction shared by logging, reports sent to reasoning
// providers, and the repository secret scan.
export const SECRET_PATTERNS = Object.freeze([
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI-style key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['Bearer credential', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g],
]);

const SENSITIVE_KEY = /(token|secret|password|passwd|api[-_]?key|authorization|cookie|credential|private[-_]?key)/i;

export function redactText(text) {
  let out = String(text);
  for (const [name, re] of SECRET_PATTERNS) out = out.replace(re, `[REDACTED:${name}]`);
  return out;
}

export function containsSecret(text) {
  return SECRET_PATTERNS.some(([, re]) => new RegExp(re.source).test(text));
}

// Deep copy with sensitive keys masked and secret-looking strings redacted.
export function redact(value, depth = 0) {
  if (depth > 20) return '[TRUNCATED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) && v !== null && typeof v !== 'object' ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  return value;
}
