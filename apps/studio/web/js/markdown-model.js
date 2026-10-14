// A small, safe Markdown parser for the repository's own documentation pages. It returns plain data (blocks and inline nodes); the view turns
// that into elements. Nothing here produces HTML text, raw HTML in a page is shown as text, and link targets are classified so the view can
// refuse anything that is not a web link, an in-app page or an anchor.
//
// Supported: headings, paragraphs, fenced code, ordered/unordered (nested) lists, pipe tables, block quotes, rules, images, and inline
// code, bold, italic and links. That is what the pages under docs/ use.

export function slugify(text) {
  return String(text).toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}

const INLINE = [
  { type: 'code', re: /^`([^`]+)`/ },
  { type: 'image', re: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
  { type: 'link', re: /^\[((?:[^[\]`]|`[^`]*`)+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
  { type: 'strong', re: /^\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*/ },
  { type: 'strong', re: /^__([^_]+)__/ },
  { type: 'em', re: /^\*([^*\s][^*]*)\*/ },
  { type: 'em', re: /^_([^_\s][^_]*)_(?![A-Za-z0-9])/ },
];

// Where a link points. Anything that is not one of these kinds is shown as text, never as a link.
export function classifyTarget(target) {
  const t = String(target).trim();
  if (/^https:\/\//i.test(t)) return { kind: 'external', href: t };
  if (/^#/.test(t)) return { kind: 'anchor', anchor: t.slice(1) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//')) return { kind: 'blocked' };
  const [path, anchor = ''] = t.split('#');
  return { kind: 'relative', path, anchor };
}

export function parseInline(text) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  let rest = String(text);
  while (rest.length) {
    if (rest[0] === '\\' && rest.length > 1 && /[\\`*_{}[\]()#+\-.!|<>~]/.test(rest[1])) {
      buf += rest[1];
      rest = rest.slice(2);
      continue;
    }
    let matched = false;
    if (/^[`![*_]/.test(rest)) {
      for (const { type, re } of INLINE) {
        const m = re.exec(rest);
        if (!m) continue;
        flush();
        if (type === 'code') out.push({ type, text: m[1] });
        else if (type === 'image') out.push({ type, alt: m[1], src: m[2] });
        else if (type === 'link') out.push({ type, children: parseInline(m[1]), target: m[2] });
        else out.push({ type, children: parseInline(m[1]) });
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      buf += rest[0];
      rest = rest.slice(1);
    }
  }
  flush();
  return out;
}

const plain = (inline) => inline.map((n) => n.text ?? (n.children ? plain(n.children) : n.alt ?? '')).join('');
const isBlank = (l) => /^\s*$/.test(l);
const FENCE = /^\s*(```+|~~~+)\s*([A-Za-z0-9_+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const splitRow = (line) => {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '|'; i++; } else if (t[i] === '|') { cells.push(cur.trim()); cur = ''; } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
};

export function parseMarkdown(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const seen = new Map();
  const uniqueId = (text) => {
    const base = slugify(text) || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
  return parseBlocks(lines, uniqueId);
}

function parseBlocks(lines, uniqueId) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lang: fence[2] || null, text: body.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const inline = parseInline(h[2]);
      blocks.push({ type: 'heading', level: h[1].length, inline, id: uniqueId(plain(inline)) });
      i++;
      continue;
    }
    if (RULE.test(line) && !LIST.test(line)) { blocks.push({ type: 'rule' }); i++; continue; }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', blocks: parseBlocks(body, uniqueId) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) rows.push(splitRow(lines[i++]).map(parseInline));
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const result = parseList(lines, i, uniqueId);
      blocks.push(result.block);
      i = result.next;
      continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !/^\s*>/.test(lines[i]) && !(LIST.test(lines[i]) && para.length) && !(RULE.test(lines[i]) && !LIST.test(lines[i]))) {
      if (lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) break;
      para.push(lines[i++].trim());
    }
    if (!para.length) { para.push(lines[i++].trim()); }
    const text = para.join(' ');
    const img = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(text);
    blocks.push(img ? { type: 'image', alt: img[1], src: img[2] } : { type: 'paragraph', inline: parseInline(text) });
  }
  return blocks;
}

function parseList(lines, start, uniqueId) {
  const first = LIST.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST.exec(lines[i]);
    if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;
    const body = [m[3]];
    i++;
    // continuation: indented lines (deeper than the marker) belong to this item, including nested lists and blank-separated paragraphs
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) {
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && (lines[j].match(/^\s*/)[0].length > baseIndent)) { body.push(''); i = j; continue; }
        break;
      }
      const indent = l.match(/^\s*/)[0].length;
      const marker = LIST.exec(l);
      if (indent > baseIndent) { body.push(l.slice(Math.min(indent, baseIndent + 2))); i++; continue; }
      if (marker && indent === baseIndent) break;
      if (!marker && indent === baseIndent && !FENCE.test(l) && !HEADING.test(l)) { body.push(l.trim()); i++; continue; }
      break;
    }
    const inner = parseBlocks(body, uniqueId);
    // a single paragraph is a "tight" item: show its text directly
    items.push(inner.length === 1 && inner[0].type === 'paragraph' ? { inline: inner[0].inline, blocks: [] } : inner[0]?.type === 'paragraph' ? { inline: inner[0].inline, blocks: inner.slice(1) } : { inline: [], blocks: inner });
  }
  return { block: { type: 'list', ordered, items }, next: i };
}

export const headingsOf = (blocks) => blocks.filter((b) => b.type === 'heading').map((b) => ({ level: b.level, id: b.id, text: plain(b.inline) }));
export const titleOf = (blocks) => { const h = blocks.find((b) => b.type === 'heading'); return h ? plain(h.inline) : null; };
export const inlineText = plain;
