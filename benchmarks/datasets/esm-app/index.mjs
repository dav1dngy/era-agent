import { createClient } from './lib/client.mjs';
import { formatReport, VERSION } from './lib/format.mjs';
import { readFile } from 'node:fs/promises';

export async function main(path) {
  const client = createClient('wss://events.example.test/stream');
  const raw = await readFile(path, 'utf8');
  return formatReport(client, raw, VERSION);
}
