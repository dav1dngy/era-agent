// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
// Violates the clean-room rule: copies the reference's source into the new project.
import { cpSync } from 'node:fs';
cpSync(process.env.REF_DIR, '.', { recursive: true });
