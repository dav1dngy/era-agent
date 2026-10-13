// What a coding agent is allowed to see. Applied when the isolated working copy is made, so a
// remote provider never receives credential files, and a hostile project cannot smuggle
// instructions to an agent through the files that agents load automatically.
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SECRET_PATTERNS } from '../safety/secrets.js';
import { agentCapabilities } from '../agents/coding-agents.js';
import { rolesOf, rolesProviders } from '../agents/team.js';
import { walkFiles } from './workspace.js';

const SENSITIVE_FILE = /(^|\/)(\.env(\.[^/]*)?|\.envrc|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.dockercfg|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|[^/]*\.(pem|key|p12|pfx|jks|keystore|kdbx|tfvars)|terraform\.tfstate(\.backup)?|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|service-account[^/]*\.json)$/i;
// Files that agent CLIs load as instructions from their working directory.
const INSTRUCTION_FILE = /(^|\/)(AGENTS\.md|CLAUDE\.local\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.github\/copilot-instructions\.md)$|(^|\/)\.(claude|codex|cursor|gemini|windsurf)\//i;

export const isSensitiveFile = (rel) => SENSITIVE_FILE.test(rel);
export const isInstructionFile = (rel) => INSTRUCTION_FILE.test(rel);

// Which providers, if any, will see the working copy for this project.
export function exposedProviders(project, config) {
  const ids = rolesProviders(rolesOf(project));
  const rows = [];
  for (const id of ids) {
    try {
      rows.push({ id, caps: agentCapabilities(id, config) });
    } catch {
      // unknown ids are rejected elsewhere
    }
  }
  return rows;
}

// Returns (relativePath) => reason | null, or null when no exclusion applies.
export function exposureFilter(project, config) {
  const rows = exposedProviders(project, config);
  const remote = rows.some((r) => r.caps.remote);
  const instructions = rows.some((r) => r.caps.readsInstructionFiles) && project.exposure?.keep_instruction_files !== true;
  if (!remote && !instructions) return null;
  return (rel) => {
    if (remote && isSensitiveFile(rel)) return 'credential-like file withheld from remote AI providers';
    if (instructions && isInstructionFile(rel)) return 'agent instruction file withheld (project content is untrusted data, not instructions)';
    return null;
  };
}

const readHead = (file, n) => {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const got = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
};

// Names of secret kinds found in source files (never the values). Text files up to 1 MB.
export function scanSecretContent(root, { maxHits = 50 } = {}) {
  const hits = [];
  for (const f of walkFiles(root)) {
    if (f.type !== 'file' || (f.size ?? 0) > 1_000_000 || (f.size ?? 0) === 0) continue;
    const full = join(root, f.rel);
    try {
      if (statSync(full).size === 0 || readHead(full, 512).includes(0)) continue;
      const text = readFileSync(full, 'utf8');
      for (const [name, re] of SECRET_PATTERNS) {
        if (new RegExp(re.source).test(text)) hits.push({ file: f.rel, kind: name });
      }
    } catch {
      // unreadable files cannot be sent either
    }
    if (hits.length >= maxHits) break;
  }
  return hits;
}
