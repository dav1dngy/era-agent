// Code Modification Controller: runs a configured implementer (for example a
// headless Claude Code invocation) inside the experiment worktree only, then
// commits whatever it changed on the experiment branch.
import { runProcess } from '../core/process.js';
import { commitAll } from '../orchestration/versions.js';

export async function runImplementer({ command, worktree, proposalFile, instructionsFile, timeoutMs, cycleId }) {
  const env = { ...process.env, ERA_PROPOSAL_FILE: proposalFile, ERA_INSTRUCTIONS_FILE: instructionsFile, ERA_WORKTREE: worktree, ERA_CYCLE_ID: cycleId };
  const r = await runProcess('/bin/sh', ['-c', command], { cwd: worktree, env, timeoutMs });
  const commit = await commitAll(worktree, `experiment ${cycleId}: implementer changes`);
  return {
    command,
    exit_code: r.exitCode,
    timed_out: r.timedOut,
    duration_ms: Math.round(r.durationMs),
    stdout_tail: r.stdout.slice(-4000),
    stderr_tail: r.stderr.slice(-4000),
    commit,
    ok: r.exitCode === 0 && !r.timedOut,
  };
}
