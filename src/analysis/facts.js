// Converts REA Evidence into normalized, comparable facts ("category:value").
// Facts drive the human-readable report, self-analysis rules and benchmarks.

const URL_RE = /^(https?|wss?):\/\/[^\s"'`]+$/;

function moduleLabelIndex(graph) {
  const byId = new Map();
  for (const node of graph?.nodes ?? []) {
    const obs = node.observations?.[0];
    byId.set(node.node_id, { kind: node.kind, label: obs?.label ?? null, props: obs?.properties ?? {} });
  }
  return byId;
}

function moduleOf(nodeInfo) {
  if (!nodeInfo) return null;
  return nodeInfo.props.module_path ?? nodeInfo.label?.split(':')[0] ?? null;
}

export function javascriptFacts(evidence) {
  const nr = evidence.normalized_result ?? {};
  const graph = nr.graph ?? {};
  const sem = nr.semantic_graph ?? {};
  const index = moduleLabelIndex(graph);
  const facts = new Set();

  for (const [, info] of index) {
    if (info.kind === 'javascript-module' && info.props.semantic_role === 'source-module') facts.add(`module:${info.label}`);
  }
  for (const edge of graph.edges ?? []) {
    const p = edge.properties ?? {};
    if (edge.relation === 'imports' && p.kind) {
      const from = moduleOf(index.get(edge.source_node_id));
      if (p.resolved_path) facts.add(`import:${from}->${p.resolved_path}`);
      else if (p.specifier && !p.specifier.startsWith('.') && !p.specifier.startsWith('/')) facts.add(`external:${p.specifier.replace(/^node:/, '')}`);
      else if (p.specifier) facts.add(`unresolved:${from}->${p.specifier}`);
    } else if (edge.relation === 'exposes' && p.exported_name) {
      const mod = moduleOf(index.get(edge.source_node_id)) ?? moduleOf(index.get(edge.target_node_id));
      facts.add(`export:${mod}#${p.exported_name}`);
    } else if (edge.relation === 'loads' && p.resolution_context === 'package-entrypoint' && p.resolved_path) {
      facts.add(`entry:${p.resolved_path}`);
    }
  }
  for (const node of sem.nodes ?? []) {
    const v = node.properties?.value;
    if (node.kind === 'literal' && typeof v === 'string' && URL_RE.test(v)) facts.add(`endpoint:${v}`);
  }
  return [...facts].sort();
}

export function machoFacts(evidence) {
  const nr = evidence.normalized_result ?? {};
  const facts = new Set();
  for (const e of nr.exports?.items ?? []) facts.add(`export:${e.name}`);
  for (const i of nr.imports?.items ?? []) facts.add(`import:${i.name}`);
  for (const d of nr.dependencies?.items ?? nr.dependencies ?? []) {
    const name = typeof d === 'string' ? d : d?.name ?? d?.path;
    if (name) facts.add(`dependency:${name}`);
  }
  for (const a of nr.architectures?.items ?? nr.architectures ?? []) {
    const name = typeof a === 'string' ? a : a?.name ?? a?.architecture;
    if (name) facts.add(`arch:${name}`);
  }
  return [...facts].sort();
}

export function artifactFacts(evidence) {
  const facts = new Set();
  const stack = [evidence.normalized_result];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) stack.push(...v);
    else if (v && typeof v === 'object') {
      if (typeof v.logical_path === 'string' && v.entry_kind === 'file' && v.logical_path !== '.') facts.add(`member:${v.logical_path}`);
      stack.push(...Object.values(v));
    }
  }
  return [...facts].sort();
}

// Hopper/Ghidra name import stubs differently; normalize to the linked symbol.
export function normalizeNativeName(name) {
  return String(name).replace(/^imp___stubs_/, '').replace(/^j_/, '');
}

export function functionFacts(evidence) {
  const nr = evidence.normalized_result ?? {};
  const name = nr.procedure?.name;
  if (!name) return [];
  const facts = new Set([`function:${name}`]);
  for (const c of nr.callees ?? []) if (c?.name) facts.add(`call:${name}->${normalizeNativeName(c.name)}`);
  for (const str of nr.referenced_strings ?? []) if (typeof str.value === 'string') facts.add(`string:${JSON.stringify(str.value).slice(1, -1)}`);
  return [...facts].sort();
}

export function processFacts(evidence) {
  const exit = evidence.normalized_result?.exit;
  return exit ? [`exit:${exit.code ?? exit.signal ?? exit.reason}`] : [];
}

export function extractFacts(evidence) {
  switch (evidence?.operation) {
    case 'analyze_javascript_application':
      return javascriptFacts(evidence);
    case 'inspect_macho':
      return machoFacts(evidence);
    case 'inspect_artifact':
      return artifactFacts(evidence);
    case 'capture_process_scenario':
      return processFacts(evidence);
    case 'analyze_function':
      return functionFacts(evidence);
    default:
      return [];
  }
}

export function groupFacts(facts) {
  const groups = {};
  for (const f of facts) {
    const i = f.indexOf(':');
    const cat = f.slice(0, i);
    (groups[cat] ??= []).push(f.slice(i + 1));
  }
  return groups;
}
