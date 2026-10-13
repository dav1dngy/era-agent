// Path and identity anonymization for files intended for publication
// (exported experiment evidence, reports). Replaces local absolute paths with
// neutral placeholders; the meaning of the evidence is unchanged, but Evidence
// IDs and digests refer to the original, unredacted REA outputs.
import { homedir } from 'node:os';

const home = homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function anonymize(text, { repoRoot = process.cwd() } = {}) {
  const root = repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text)
    .replace(new RegExp(root, 'g'), '<era-repo>')
    .replace(new RegExp(`${home}/\\.nvm/versions/node/v[0-9.]+`, 'g'), '<node-prefix>')
    .replace(/(?:\/private)?\/var\/folders\/[A-Za-z0-9_+-]+\/[A-Za-z0-9_+-]+\/T\/?/g, '<tmp>/')
    .replace(/\/private\/tmp\/claude-\d+\/[^\s"'`)]*/g, '<tmp>')
    .replace(new RegExp(home, 'g'), '~');
}

// Generic personal-path detector used by scripts/check.mjs.
export const PERSONAL_PATH = /(?:^|[\s"'`(=])\/(?:Users|home)\/[A-Za-z0-9._-]+\//m;
