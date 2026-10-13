// Code Modification Controller: runs the selected coding agent inside the
// experiment worktree only, then commits whatever it changed on the
// experiment branch. Budget authorization happens in the caller (cycle.js).
import { commitAll } from '../orchestration/versions.js';
import { commandAgent } from '../agents/coding-agents.js';

export async function runCodingAgent({ agent, task }) {
  const result = await agent.implement(task);
  const commit = await commitAll(task.worktree, `experiment ${task.cycleId}: implementer changes (${agent.id})`);
  return { agent: agent.id, ...result, commit };
}

// Backward-compatible entry point for a plain shell implementer command.
export async function runImplementer({ command, worktree, proposalFile, instructionsFile, timeoutMs, cycleId }) {
  return runCodingAgent({ agent: commandAgent(command), task: { worktree, proposalFile, instructionsFile, timeoutMs, cycleId, budgetUsd: null } });
}
