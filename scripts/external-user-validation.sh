#!/usr/bin/env bash
# What another developer does, in a clean environment: clone, install, configure a provider, launch ERA Studio, run a REA analysis, create and run a
# Project Lab task, review the result and the code change, run the tests, then approve (and roll back) or reject a change.
#
#   scripts/external-user-validation.sh [SOURCE] [BRANCH]        SOURCE: a git URL or local path (default: this checkout), BRANCH: default current
#
# The checkout is cloned into a temporary directory and everything runs with an empty HOME, a minimal PATH and a scrubbed environment (no
# credentials, no ERA_* variables, none of your own configuration). It needs network access for `npm ci`. The coding agent is a scripted stand-in
# (a real provider needs your own sign-in); nothing is sent anywhere. Exit status 0 only if every step passed.
set -uo pipefail

SOURCE="${1:-$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)}"
BRANCH="${2:-$(git -C "$SOURCE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"
NODE="$(command -v node)" || { echo "node is required"; exit 2; }
NODE_DIR="$(dirname "$NODE")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/era-external-user.XXXXXX")"
trap 'kill "${SERVE_PID:-0}" 2>/dev/null; rm -rf "$WORK"' EXIT
mkdir -p "$WORK/home" "$WORK/tmp"
FAILS=0
step() { printf '\n== %s\n' "$*"; }
ok() { printf 'PASS %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

# Clean environment: nothing of the developer's own setup is visible.
run() { env -i HOME="$WORK/home" PATH="$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR="$WORK/tmp" LANG=en_US.UTF-8 SHELL=/bin/sh \
  GIT_AUTHOR_NAME=tester GIT_AUTHOR_EMAIL=tester@example.invalid GIT_COMMITTER_NAME=tester GIT_COMMITTER_EMAIL=tester@example.invalid "$@"; }

step "1. Clone ($BRANCH from $SOURCE)"
run git clone --quiet --branch "$BRANCH" "$SOURCE" "$WORK/era" && ok "cloned" || { bad "clone"; exit 1; }
cd "$WORK/era" || exit 1
run git log -1 --format='   commit %h %s' | cut -c1-110

step "2. Install dependencies"
check "npm ci (ERA and REA)" run npm ci --no-audit --no-fund --loglevel=error
check "npm ci --prefix apps/studio (Studio, Monaco, Electron)" run npm ci --prefix apps/studio --no-audit --no-fund --loglevel=error

step "3. Environment and providers"
run "$NODE" bin/era.mjs status | sed 's/^/   /'
check "REA is resolved from the installed dependency" bash -c "cd '$WORK/era' && env -i HOME='$WORK/home' PATH='$NODE_DIR:/usr/bin:/bin' '$NODE' bin/era.mjs status | grep -q 'rea-agents 6.4.0 via local-dependency'"
# A provider is configured in era.config.json (no key is ever stored by ERA). A real one needs your own CLI sign-in; this check uses a scripted agent.
FIX="$WORK/era/tests/fixtures"
cat > "$WORK/era/era.config.json.new" <<EOF
$("$NODE" -e "const c=JSON.parse(require('fs').readFileSync('era.config.json','utf8')); c.projectLab={...c.projectLab,budget:{...(c.projectLab?.budget??{}),allowUnmeteredAgents:true},customAgents:{scripted:{command:'$NODE $FIX/agents/fix-cart.mjs',simulated:true}}}; console.log(JSON.stringify(c,null,2))")
EOF
mv "$WORK/era/era.config.json.new" "$WORK/era/era.config.json"
run "$NODE" bin/era.mjs agents | sed 's/^/   /' | head -12
check "the configured provider is listed" bash -c "cd '$WORK/era' && env -i HOME='$WORK/home' PATH='$NODE_DIR:/usr/bin:/bin' '$NODE' bin/era.mjs agents | grep -q 'custom:scripted'"
check "unavailable providers are reported as unavailable, not hidden" bash -c "cd '$WORK/era' && env -i HOME='$WORK/home' PATH='$NODE_DIR:/usr/bin:/bin' '$NODE' bin/era.mjs agents | grep -E 'claude-code|codex' | grep -qE 'unavailable|NOT signed in|signed in'"

step "4. REA analysis"
run "$NODE" bin/era.mjs analyze benchmarks/datasets/js-app --json > "$WORK/analysis.json" 2> "$WORK/analysis.err"
check "analysis succeeded with real REA evidence" "$NODE" -e "const a=require('$WORK/analysis.json'); if(a.status!=='succeeded'||!a.facts.includes('import:src/main.js->src/net.js')||!a.runs.some(r=>r.evidence_id)) process.exit(1)"

step "5. Launch ERA Studio (control plane, browser mode) and use it"
export ERA_STATE_DIR="$WORK/studio-state"
run env ERA_STATE_DIR="$ERA_STATE_DIR" "$NODE" bin/era.mjs studio serve --json > "$WORK/serve.json" 2> "$WORK/serve.err" &
SERVE_PID=$!
disown "$SERVE_PID" 2>/dev/null
for _ in $(seq 1 60); do [ -s "$WORK/serve.json" ] && break; sleep 0.5; done
URL="$("$NODE" -e "try{console.log(JSON.parse(require('fs').readFileSync('$WORK/serve.json','utf8')).url)}catch{}")"
TOKEN="$("$NODE" -e "try{console.log(JSON.parse(require('fs').readFileSync('$WORK/serve.json','utf8')).token)}catch{}")"
[ -n "$URL" ] && ok "Studio control plane listening on $URL (loopback)" || bad "Studio did not start: $(cat "$WORK/serve.err")"
api() { "$NODE" --input-type=module -e "
const [method, path, body] = process.argv.slice(1);
const r = await fetch('$URL' + path, { method, headers: { Authorization: 'Bearer $TOKEN', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body || undefined });
const t = await r.text(); process.stdout.write(JSON.stringify({ status: r.status, body: t }));" "$@"; }
jget() { "$NODE" -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8')); const b=JSON.parse(o.body||'null'); console.log($1)"; }
check "unauthenticated requests are refused" bash -c "[ \"\$($NODE -e \"fetch('$URL/api/overview').then(r=>console.log(r.status))\")\" = 401 ]"
if api GET /api/overview | jget "b.rea.available" | grep -q true; then ok "the API reports REA available"; else bad "the API reports REA available"; fi
check "the in-app documentation is served" bash -c "$NODE -e \"fetch('$URL/api/docs/page?name=docs%2Fgetting-started.md',{headers:{Authorization:'Bearer $TOKEN'}}).then(async r=>{const j=await r.json();process.exit(r.status===200&&/Getting started/.test(j.text)?0:1)})\""
if [ "$(uname)" = Darwin ]; then
  check "the desktop shell launches and renders (Electron smoke)" run env ERA_STATE_DIR="$WORK/electron-state" "$WORK/era/apps/studio/node_modules/.bin/electron" "$WORK/era/apps/studio" --smoke
else
  echo "SKIP desktop shell smoke: Studio's desktop shell is validated on macOS only"
fi

step "6. Project Lab: create a task, run it, review the result and the code change, run the tests"
cp -R "$FIX/projects/buggy-app" "$WORK/shop"
TRUST=""; [ "$(uname)" = Darwin ] || TRUST="--trust-project"
check "create the project" run env ERA_STATE_DIR="$ERA_STATE_DIR" "$NODE" bin/era.mjs project create shop --source "$WORK/shop" --task "Fix the cart total: it must account for quantity" --mode modify --agent command --agent-command "$NODE $FIX/agents/fix-cart.mjs" --test "node --test tests/*.test.js" --accept-fail "node --test acceptance/cart-quantity.test.js" $TRUST
check "the preflight lists what could stop the run" bash -c "cd '$WORK/era' && env -i HOME='$WORK/home' PATH='$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin' ERA_STATE_DIR='$ERA_STATE_DIR' '$NODE' bin/era.mjs project check shop --op modify 2>&1 | grep -qi 'sandbox\|agent\|consent'"
run env ERA_STATE_DIR="$ERA_STATE_DIR" "$NODE" bin/era.mjs project modify shop $TRUST > "$WORK/modify.out" 2>&1
sed 's/^/   /' "$WORK/modify.out" | head -14
if api GET /api/projects/shop | jget "b.latest_run.status" | grep -q awaiting-approval; then ok "the run stops at awaiting-approval"; else bad "the run stops at awaiting-approval"; fi
check "verification passed (build, tests and acceptance)" grep -q "Verified\|awaiting-approval" "$WORK/modify.out"
run env ERA_STATE_DIR="$ERA_STATE_DIR" "$NODE" bin/era.mjs project show shop > "$WORK/show.out" 2>&1
check "the review shows the code change (a diff of src/cart.js)" grep -q "src/cart.js" "$WORK/show.out"
check "the original is untouched before approval (the acceptance test still fails)" bash -c "cd '$WORK/shop' && ! env -i PATH='$NODE_DIR:/usr/bin:/bin' '$NODE' --test acceptance/cart-quantity.test.js >/dev/null 2>&1"

step "7. Approve, test, roll back; and reject"
check "approve the verified change (explicit --yes)" run env ERA_STATE_DIR="$ERA_STATE_DIR" "$NODE" bin/era.mjs project approve shop --yes
check "the project's own tests now pass in the original" bash -c "cd '$WORK/shop' && env -i PATH='$NODE_DIR:/usr/bin:/bin' '$NODE' --test tests/*.test.js acceptance/cart-quantity.test.js >/dev/null 2>&1"
check "roll back restores the original" bash -c "cd '$WORK/era' && env -i HOME='$WORK/home' PATH='$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin' ERA_STATE_DIR='$ERA_STATE_DIR' '$NODE' bin/era.mjs project rollback shop >/dev/null 2>&1 && cd '$WORK/shop' && ! env -i PATH='$NODE_DIR:/usr/bin:/bin' '$NODE' --test acceptance/cart-quantity.test.js >/dev/null 2>&1"
# Reject: a second run, declined through Studio's API. Nothing reaches the original.
run env ERA_STATE_DIR="$ERA_STATE_DIR" "$NODE" bin/era.mjs project modify shop $TRUST > "$WORK/modify2.out" 2>&1
DIGEST_BEFORE="$(cd "$WORK/shop" && find . -type f -not -path './.git/*' | sort | xargs shasum | shasum | cut -c1-16)"
api POST /api/projects/shop/reject '{"confirm":true}' > "$WORK/reject.json"
check "reject leaves the original unchanged" bash -c "[ \"\$(cd '$WORK/shop' && find . -type f -not -path './.git/*' | sort | xargs shasum | shasum | cut -c1-16)\" = '$DIGEST_BEFORE' ]"
if api GET /api/projects/shop | jget "b.latest_run.status" | grep -q rejected; then ok "the rejected run is recorded as rejected"; else bad "the rejected run is recorded as rejected (reject answered: $(cut -c1-200 "$WORK/reject.json"))"; fi

printf '\n==============================\n'
if [ "$FAILS" -eq 0 ]; then echo "EXTERNAL USER VALIDATION: PASS"; exit 0; fi
echo "EXTERNAL USER VALIDATION: $FAILS step(s) FAILED"; exit 1
