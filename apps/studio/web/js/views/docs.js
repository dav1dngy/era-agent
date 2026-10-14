// Documentation: renders the repository's own Markdown pages, served read-only by the control plane (/api/docs), so there is exactly one
// copy of the text. Sections: #/docs/<section>?doc=<page>&h=<heading>. Pages are parsed by markdown-model.js into data and drawn as
// elements; nothing is inserted as HTML, and only https links, in-app pages and anchors become links.
import { html, useEffect, useMemo, useState } from '../html.js';
import { get } from '../api.js';
import { Callout, Spinner } from '../ui.js';
import { navigate } from '../store.js';
import { AuthImage } from './rebuild.js';
import { classifyTarget, headingsOf, parseMarkdown } from '../markdown-model.js';

let indexCache = null;
const loadIndex = () => (indexCache ??= get('/api/docs').catch((e) => { indexCache = null; throw e; }));

// Repository-relative path of a link or image written relative to `fromFile`.
export function resolveRepoPath(fromFile, rel) {
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const parts = `${dir}/${rel}`.split('/').reduce((acc, part) => (part === '..' ? acc.slice(0, -1) : part === '.' || part === '' ? acc : [...acc, part]), []);
  return parts.join('/');
}

export const docHref = (section, doc, anchor) => `#/docs/${section}${doc || anchor ? `?${new URLSearchParams({ ...(doc ? { doc } : {}), ...(anchor ? { h: anchor } : {}) })}` : ''}`;

function Inline({ nodes, ctx }) {
  return nodes.map((n, i) => {
    if (n.type === 'text') return n.text;
    if (n.type === 'code') return html`<code key=${i}>${n.text}</code>`;
    if (n.type === 'strong') return html`<strong key=${i}><${Inline} nodes=${n.children} ctx=${ctx} /></strong>`;
    if (n.type === 'em') return html`<em key=${i}><${Inline} nodes=${n.children} ctx=${ctx} /></em>`;
    if (n.type === 'image') return html`<${DocImage} key=${i} src=${n.src} alt=${n.alt} ctx=${ctx} />`;
    if (n.type === 'link') return html`<${DocLink} key=${i} target=${n.target} ctx=${ctx}><${Inline} nodes=${n.children} ctx=${ctx} /><//>`;
    return null;
  });
}

function DocLink({ target, ctx, children }) {
  const t = classifyTarget(target);
  if (t.kind === 'external') return html`<a href=${t.href} target="_blank" rel="noreferrer noopener">${children}</a>`;
  if (t.kind === 'anchor') return html`<a href=${docHref(ctx.section, ctx.file === ctx.mainFile ? null : ctx.file, t.anchor)}>${children}</a>`;
  if (t.kind === 'relative' && t.path.endsWith('.md')) {
    const page = resolveRepoPath(ctx.file, t.path);
    const owner = ctx.pages.get(page);
    if (owner) return html`<a href=${docHref(owner.section, owner.main ? null : page, t.anchor)}>${children}</a>`;
  }
  // a file that is not part of the in-app documentation, or a link that is not allowed: show the text, not a link
  return html`<span class="muted" title=${t.kind === 'blocked' ? 'This link is not opened from the documentation.' : 'Not available in the app: see the repository.'}>${children}</span>`;
}

function DocImage({ src, alt, ctx }) {
  const name = resolveRepoPath(ctx.file, src);
  if (!/^docs\/assets\//.test(name)) return html`<span class="muted">[image: ${alt}]</span>`;
  return html`<${AuthImage} src=${`/api/docs/image?name=${encodeURIComponent(name)}`} alt=${alt} class="doc-image" />`;
}

function Blocks({ blocks, ctx }) {
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'heading': {
        const Tag = `h${Math.min(6, b.level + 1)}`; // the app's page title ("Documentation") is the h1; a document's own title becomes h2
        return html`<${Tag} key=${i} id=${`doc-h-${b.id}`} class="doc-heading"><${Inline} nodes=${b.inline} ctx=${ctx} /></${Tag}>`;
      }
      case 'paragraph': return html`<p key=${i}><${Inline} nodes=${b.inline} ctx=${ctx} /></p>`;
      case 'image': return html`<figure key=${i} class="doc-figure"><${DocImage} src=${b.src} alt=${b.alt} ctx=${ctx} /><figcaption class="muted">${b.alt}</figcaption></figure>`;
      case 'code': return html`<pre key=${i} class="mono doc-code" tabindex="0"><code>${b.text}</code></pre>`;
      case 'rule': return html`<hr key=${i} />`;
      case 'quote': return html`<blockquote key=${i} class="doc-quote"><${Blocks} blocks=${b.blocks} ctx=${ctx} /></blockquote>`;
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        return html`<${Tag} key=${i}>${b.items.map((it, j) => html`<li key=${j}><${Inline} nodes=${it.inline} ctx=${ctx} /><${Blocks} blocks=${it.blocks} ctx=${ctx} /></li>`)}</${Tag}>`;
      }
      case 'table': return html`<div key=${i} class="doc-table" role="region" aria-label="Table" tabindex="0"><table><thead><tr>${b.header.map((c, j) => html`<th key=${j}><${Inline} nodes=${c} ctx=${ctx} /></th>`)}</tr></thead><tbody>${b.rows.map((r, j) => html`<tr key=${j}>${r.map((c, k) => html`<td key=${k}><${Inline} nodes=${c} ctx=${ctx} /></td>`)}</tr>`)}</tbody></table></div>`;
      default: return null;
    }
  });
}

export function DocsView({ route }) {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(null);
  useEffect(() => { loadIndex().then(setIndex).catch((e) => setError(e.message)); }, []);

  const sectionId = route.path[1] ?? 'getting-started';
  const section = index?.sections.find((s) => s.id === sectionId) ?? index?.sections[0];
  const file = route.query.doc && section && [section.file, ...section.related].includes(route.query.doc) ? route.query.doc : section?.file;
  useEffect(() => {
    if (!file) return;
    setPage(null);
    get(`/api/docs/page?name=${encodeURIComponent(file)}`).then(setPage).catch((e) => setPage({ error: e.message }));
  }, [file]);

  const blocks = useMemo(() => (page?.text ? parseMarkdown(page.text) : null), [page?.text]);
  const pages = useMemo(() => new Map((index?.sections ?? []).flatMap((s) => [[s.file, { section: s.id, main: true }], ...s.related.map((f) => [f, { section: s.id, main: false }])])), [index]);
  useEffect(() => {
    if (!blocks) return;
    const target = route.query.h ? document.getElementById(`doc-h-${route.query.h}`) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else document.getElementById('docs-article')?.scrollTo?.({ top: 0 });
  }, [blocks, route.query.h]);

  if (error) return html`<div class="page"><${Callout} kind="bad" title="Documentation unavailable">${error}<//></div>`;
  if (!index) return html`<div class="page"><${Spinner} /></div>`;
  if (!index.available) return html`<div class="page"><${Callout} title="Documentation is not part of this installation">The documentation pages ship with the source checkout and the desktop app. Read them in the repository under docs/.<//></div>`;

  const ctx = { section: section.id, file, mainFile: section.file, pages };
  const toc = blocks ? headingsOf(blocks).filter((h) => h.level === 2) : [];
  return html`<div class="page docs-page">
    <div class="page-head"><div class="grow"><h1>Documentation</h1><p>The project's own documentation, shown offline. Pages open here; links to the web open in your browser.</p></div></div>
    <div class="docs-layout">
      <nav class="docs-nav" aria-label="Documentation sections">
        ${index.sections.map((s) => html`<div key=${s.id}>
          <a class=${`docs-nav-item ${s.id === section.id ? 'current' : ''}`} href=${docHref(s.id)} aria-current=${s.id === section.id && file === s.file ? 'page' : undefined}>${s.title}</a>
          ${s.id === section.id && s.related.length ? html`<ul class="docs-related">${s.related.map((f) => html`<li key=${f}><a class=${f === file ? 'current' : ''} href=${docHref(s.id, f)} aria-current=${f === file ? 'page' : undefined}>${f.replace(/^docs\//, '').replace(/\.md$/, '').replace(/[-_]/g, ' ')}</a></li>`)}</ul>` : null}
        </div>`)}
      </nav>
      <article class="docs-article" id="docs-article" aria-live="polite">
        ${page?.error ? html`<${Callout} kind="bad" title="This page could not be loaded">${page.error}<//>` : !blocks ? html`<${Spinner} />` : html`
          <div class="doc-body"><${Blocks} blocks=${blocks} ctx=${ctx} /></div>`}
      </article>
      ${toc.length ? html`<aside class="docs-toc" aria-label="On this page"><b>On this page</b><ul>${toc.map((h) => html`<li key=${h.id}><a href=${docHref(section.id, file === section.file ? null : file, h.id)}>${h.text}</a></li>`)}</ul></aside>` : null}
    </div>
  </div>`;
}

export const openDocs = (section, anchor) => navigate(['docs', section], anchor ? { h: anchor } : undefined);
