// In-app documentation. Serves the repository's own Markdown pages and the screenshots they embed, read-only, from a fixed allowlist: the
// client names a page or an image, never a path, so nothing outside the list can be read. The app renders these pages itself; there is no
// second copy of the text anywhere in the UI.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missing } from '../errors.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAX_PAGE_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 5_000_000;

// Section id, title, main page, and related pages that belong to the same topic. Files are repository-relative.
export const DOC_SECTIONS = Object.freeze([
  { id: 'getting-started', title: 'Getting Started', file: 'docs/getting-started.md', related: ['docs/ERA_STUDIO.md'] },
  { id: 'installation', title: 'Installation', file: 'docs/installation.md', related: [] },
  { id: 'project-lab', title: 'Project Lab', file: 'docs/project-lab.md', related: ['docs/project-configuration.md', 'docs/screenshot-rebuild.md'] },
  { id: 'reverse-engineering', title: 'Reverse Engineering', file: 'docs/rea-integration.md', related: ['docs/original-rea-analysis.md', 'docs/benchmark-methodology.md'] },
  { id: 'multi-agent', title: 'Multi-Agent Configuration', file: 'docs/multi-agent.md', related: ['docs/provider-configuration.md'] },
  { id: 'improvement-lab', title: 'Improvement Lab', file: 'docs/improvement-lab.md', related: ['docs/self-improvement.md', 'docs/ERA_STUDIO_SELF_IMPROVEMENT.md'] },
  { id: 'security', title: 'Security and Permissions', file: 'docs/ERA_STUDIO_SECURITY.md', related: ['SECURITY.md'] },
  { id: 'troubleshooting', title: 'Troubleshooting', file: 'docs/troubleshooting.md', related: ['docs/SUPPORT_AND_VALIDATION.md'] },
]);

const PAGES = new Set(DOC_SECTIONS.flatMap((s) => [s.file, ...s.related]));
const IMAGE = /^docs\/assets\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.(png|jpe?g)$/;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export function docsService({ root = ROOT } = {}) {
  const abs = (rel) => join(root, rel);

  function index() {
    return {
      available: DOC_SECTIONS.some((s) => existsSync(abs(s.file))),
      sections: DOC_SECTIONS.map((s) => ({ id: s.id, title: s.title, file: s.file, related: s.related.filter((f) => existsSync(abs(f))) })),
    };
  }

  function page(name) {
    if (typeof name !== 'string' || !PAGES.has(name)) throw missing('Unknown documentation page.');
    const file = abs(name);
    if (!existsSync(file) || statSync(file).size > MAX_PAGE_BYTES) throw missing('This documentation page is not part of this installation.');
    return { name, text: readFileSync(file, 'utf8') };
  }

  function image(name) {
    if (typeof name !== 'string' || name.includes('..') || !IMAGE.test(name)) throw missing('Unknown documentation image.');
    const file = abs(name);
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > MAX_IMAGE_BYTES) throw missing('This image is not part of this installation.');
    return { bytes: readFileSync(file), mime: MIME[name.split('.').pop().toLowerCase()] };
  }

  return { index, page, image };
}
