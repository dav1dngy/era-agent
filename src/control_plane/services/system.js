// Backend facts for the Studio chrome and the Settings → MCP & Tools / Advanced pages.
import { existsSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join } from 'node:path';
import { sandboxAvailable } from '../../safety/sandbox.js';
import { HARD_LIMITS, PROTECTED_PATHS } from '../../safety/policy.js';

export function systemService(ctx) {
  async function overview() {
    const rea = await ctx.rea.status();
    const projects = ctx.lab.list();
    return {
      app: { name: 'ERA Studio', version: ctx.version, node: process.version, platform: `${platform()} ${release()} ${arch()}` },
      mode: ctx.settings().mode,
      rea: { available: rea.available, version: rea.version ?? null, command: rea.command, decompiler_available: rea.decompiler_available ?? false, error: rea.error ?? null },
      sandbox: { available: sandboxAvailable(), mechanism: sandboxAvailable() ? 'macos-sandbox-exec' : null },
      state_dir: ctx.config.stateDirAbs,
      counts: { projects: projects.length, awaiting_approval: projects.filter((p) => p.status === 'awaiting-approval').length, running_jobs: ctx.jobs.list().filter((j) => j.status === 'running').length },
      listener: { host: ctx.host, port: ctx.port, loopback_only: true },
      ci: !!(process.env.CI || process.env.GITHUB_ACTIONS),
    };
  }

  // MCP & Tools page: REA integration status and ERA's own MCP entry (REA ships the MCP server).
  async function tools() {
    const rea = await ctx.rea.status();
    return {
      rea: { available: rea.available, version: rea.version ?? null, command: rea.command, decompiler_available: rea.decompiler_available ?? false, error: rea.error ?? null },
      mcp: { provider: 'REA (original engine)', launch: 'era rea mcp', doctor: 'era rea mcp doctor', note: 'ERA does not run its own MCP server; REA provides the MCP tools and ERA passes them through unchanged.' },
      permissions: ctx.settings().permissions,
    };
  }

  function diagnostics() {
    return { audit_tail: ctx.audit.tail(100), jobs: ctx.jobs.list().slice(0, 50), state_dir: ctx.config.stateDirAbs, log_dir: join(ctx.config.stateDirAbs, 'logs'), log_dir_exists: existsSync(join(ctx.config.stateDirAbs, 'logs')), hard_limits: HARD_LIMITS, protected_paths: PROTECTED_PATHS };
  }

  return { overview, tools, diagnostics };
}
