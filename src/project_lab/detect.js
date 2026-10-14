// Capability detection: what is this project, and how is it built and tested?
// Everything reported here is derived from files that exist in the project;
// commands are *candidates* until the project configuration confirms them.
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import { walkFiles } from './workspace.js';

const LANGUAGES = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin',
  '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#', '.php': 'PHP',
  '.swift': 'Swift', '.sh': 'Shell', '.lua': 'Lua', '.scala': 'Scala', '.dart': 'Dart',
};

const NODE_FRAMEWORKS = { react: 'React', 'react-dom': 'React', next: 'Next.js', vue: 'Vue', nuxt: 'Nuxt', svelte: 'Svelte', express: 'Express', fastify: 'Fastify', koa: 'Koa', '@nestjs/core': 'NestJS', electron: 'Electron', '@angular/core': 'Angular' };
const NODE_TEST_TOOLS = { jest: 'Jest', mocha: 'Mocha', vitest: 'Vitest', ava: 'AVA', tap: 'node-tap', playwright: 'Playwright', '@playwright/test': 'Playwright', cypress: 'Cypress' };
const PY_FRAMEWORKS = { django: 'Django', flask: 'Flask', fastapi: 'FastAPI', pytest: 'pytest' };

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const readText = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

// Is `tool` an executable on PATH? Searched directly: no shell is involved, so a tool name taken from a project can never
// become a shell command. Names that are not plain program names are reported as unavailable.
async function which(tool) {
  if (!/^[\w.+-]{1,64}$/.test(tool)) return false;
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    try {
      accessSync(join(dir, tool), constants.X_OK);
      return true;
    } catch {
      // not in this directory
    }
  }
  return false;
}

export async function detectProject(root) {
  const files = walkFiles(root);
  const languages = {};
  for (const f of files) {
    const lang = LANGUAGES[extname(f.rel).toLowerCase()];
    if (lang) (languages[lang] ??= { files: 0, bytes: 0 }), (languages[lang].files += 1), (languages[lang].bytes += f.size ?? 0);
  }
  const ranked = Object.entries(languages).sort((a, b) => b[1].bytes - a[1].bytes);
  const has = (name) => existsSync(join(root, name));
  const frameworks = new Set();
  const testFrameworks = new Set();
  const packageManagers = new Set();
  const build = [];
  const test = [];
  const notes = [];

  const pkg = has('package.json') ? readJson(join(root, 'package.json')) : null;
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [d, label] of Object.entries(NODE_FRAMEWORKS)) if (deps[d]) frameworks.add(label);
    for (const [d, label] of Object.entries(NODE_TEST_TOOLS)) if (deps[d]) testFrameworks.add(label);
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') ? 'bun' : 'npm';
    packageManagers.add(pm);
    const run = pm === 'npm' ? 'npm run --silent' : `${pm} run`;
    if (pkg.scripts?.build) build.push({ command: `${run} build`, source: 'package.json scripts.build' });
    if (pkg.scripts?.test && !/no test specified/.test(pkg.scripts.test)) {
      test.push({ command: pm === 'npm' ? 'npm test --silent' : `${pm} test`, source: 'package.json scripts.test' });
      if (/--test\b|node:test/.test(pkg.scripts.test)) testFrameworks.add('node:test');
    }
    if (!existsSync(join(root, 'node_modules')) && Object.keys(deps).length) notes.push('package.json declares dependencies but node_modules is not present in the project; dependency installation is not performed automatically (the sandbox has no network).');
  }
  const pyReq = `${readText(join(root, 'requirements.txt'))}\n${readText(join(root, 'pyproject.toml'))}`.toLowerCase();
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('setup.cfg')) {
    packageManagers.add(has('poetry.lock') ? 'poetry' : 'pip');
    for (const [d, label] of Object.entries(PY_FRAMEWORKS)) if (new RegExp(`\\b${d}\\b`).test(pyReq)) (d === 'pytest' ? testFrameworks : frameworks).add(label);
    if (has('pytest.ini') || /pytest/.test(pyReq)) {
      test.push({ command: 'python3 -m pytest -v', source: 'pytest configuration' });
      testFrameworks.add('pytest');
    } else if (has('tests') || has('test')) test.push({ command: 'python3 -m unittest discover -v', source: 'tests directory' });
  }
  if (has('Cargo.toml')) {
    packageManagers.add('cargo');
    build.push({ command: 'cargo build', source: 'Cargo.toml' });
    test.push({ command: 'cargo test', source: 'Cargo.toml' });
  }
  if (has('go.mod')) {
    packageManagers.add('go');
    build.push({ command: 'go build ./...', source: 'go.mod' });
    test.push({ command: 'go test -v ./...', source: 'go.mod' });
  }
  if (has('pom.xml')) {
    packageManagers.add('maven');
    test.push({ command: 'mvn -q test', source: 'pom.xml' });
  }
  if (has('build.gradle') || has('build.gradle.kts')) {
    packageManagers.add('gradle');
    test.push({ command: has('gradlew') ? './gradlew test' : 'gradle test', source: 'build.gradle' });
  }
  const makefile = readText(join(root, 'Makefile'));
  if (makefile) {
    packageManagers.add('make');
    if (/^test\s*:/m.test(makefile)) test.push({ command: 'make test', source: 'Makefile target "test"' });
    if (/^(build|all)\s*:/m.test(makefile)) build.push({ command: /^build\s*:/m.test(makefile) ? 'make build' : 'make', source: 'Makefile' });
  }
  if (has('CMakeLists.txt')) packageManagers.add('cmake');

  const checked = async (list) => {
    const out = [];
    for (const c of list) out.push({ ...c, tool_available: await which(c.command.split(/\s+/)[0]) });
    return out;
  };
  const testFiles = files.filter((f) => /(^|\/)(tests?|__tests__|spec)\//.test(f.rel) || /\.(test|spec)\.[a-z]+$/.test(f.rel) || /(^|\/)test_[^/]+\.py$/.test(f.rel)).length;
  return {
    root,
    file_count: files.length,
    bytes: files.reduce((s, f) => s + (f.size ?? 0), 0),
    languages,
    primary_language: ranked[0]?.[0] ?? null,
    frameworks: [...frameworks].sort(),
    test_frameworks: [...testFrameworks].sort(),
    package_managers: [...packageManagers].sort(),
    build: await checked(build),
    test: await checked(test),
    test_file_count: testFiles,
    javascript_files: (languages.JavaScript?.files ?? 0) + (languages.TypeScript?.files ?? 0),
    notes,
  };
}
