#!/usr/bin/env bash
# Clean-environment installation test: installs a packed ERA tarball into an
# empty npm project (downloading rea-agents from the npm registry) and runs
# basic commands with PATH limited to system directories plus Node, so a
# globally installed `rea` cannot be picked up by accident.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TARBALL="${1:-}"
if [ -z "$TARBALL" ]; then
  (cd "$ROOT" && npm pack --silent --pack-destination "$WORK" >/dev/null)
  TARBALL="$(ls "$WORK"/era-agent-*.tgz)"
fi
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"
NODE_DIR="$(dirname "$(command -v node)")"
mkdir "$WORK/project"
cd "$WORK/project"
npm init -y >/dev/null
npm install --no-audit --no-fund "$TARBALL"
export PATH="$PWD/node_modules/.bin:$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin"
export ERA_STATE_DIR="$WORK/state"
echo "== era --version"; era --version
era --help >/dev/null
echo "== era status"; era status
echo "== era analyze (JavaScript fixture)"
era analyze "$ROOT/benchmarks/datasets/js-app" --json > analysis.json
node -e "
const a = require('./analysis.json');
if (a.status !== 'succeeded') { console.error(JSON.stringify(a.runs.map(r => r.errors))); process.exit(1); }
const rea = a.runs[0].command[0];
if (!rea.includes('$WORK/project/node_modules')) { console.error('REA was not resolved from the installed dependency: ' + rea); process.exit(1); }
console.log('ok:', a.facts.length, 'facts; REA', a.engine.version, 'from', rea);
"
echo "clean install test passed"
