// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
// Prints a mix of valid and invalid review findings (to test validation). Read-only: it edits nothing.
if (process.env.ERA_READ_ONLY !== '1' || process.env.ERA_PHASE !== 'review') {
  console.error('review must run in read-only mode');
  process.exit(9);
}
const findings = [
  { title: 'Total ignores quantity', severity: 'high', category: 'correctness', file: 'src/cart.js', line: 8, snippet: 'sum + item.price', evidence: 'total() adds price once per line item regardless of quantity, so a line with quantity 3 is under-charged.', detail: 'Reported bug.', recommendation: 'Multiply by quantity.' },
  { title: 'Invented file', severity: 'high', category: 'security', file: 'src/does-not-exist.js', line: 1, evidence: 'this file does not exist anywhere', },
  { title: 'Line out of range', severity: 'low', category: 'maintainability', file: 'src/cart.js', line: 9999, evidence: 'this line number is outside the file' },
  { title: 'Bad severity', severity: 'catastrophic', category: 'security', file: 'src/cart.js', line: 1, evidence: 'severity is not a valid value' },
  { title: 'Snippet not in file', severity: 'medium', category: 'correctness', file: 'src/cart.js', line: 2, snippet: 'return fabricated(code)', evidence: 'the quoted code does not appear in the file at all' },
  { title: 'Path escape', severity: 'high', category: 'security', file: '../../etc/passwd', line: 1, evidence: 'tries to point outside the project' },
];
console.log('Here are my findings:\n```json\n' + JSON.stringify(findings, null, 2) + '\n```');
