// Node 24 native TypeScript. No shell is exposed to the Kimi model.
// 2026-09-19 fixes: UTF-8 env for kimi.exe (GBK crash), same-worktree repair loop
// with resumed session, checks gating candidate_success, best-effort token capture.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const project = process.cwd();
const taskPath = path.resolve(process.argv[2] ?? '');
const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
const base = path.resolve(task.context.base_worktree);
const worktree = path.resolve(task.context.worker_worktree);
const relativeProject = 'projects/paper2-slot-prototype';
const work = path.join(worktree, relativeProject);
const artifacts = path.join(project, 'artifacts', 'swarm', task.task_id);
fs.mkdirSync(artifacts, { recursive: true });
const utf8Env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const run = (cmd: string, args: string[], cwd = base) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, env: utf8Env });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr?.slice(-1500)}`);
  return r.stdout.trimEnd();
};
if (
  !/^[A-Z0-9-]+$/.test(task.task_id) ||
  task.budget.max_minutes > 30 ||
  task.budget.max_minutes < 1
)
  throw new Error('Invalid task budget/id');
if (!fs.existsSync(worktree)) run('git', ['worktree', 'add', '--detach', worktree, 'HEAD']);
if (!fs.existsSync(path.join(work, 'node_modules')))
  fs.symlinkSync(path.join(project, 'node_modules'), path.join(work, 'node_modules'), 'junction');
const baseCommit = run('git', ['rev-parse', 'HEAD'], worktree);
const promptPath = path.join(artifacts, 'system.md');
fs.writeFileSync(
  promptPath,
  'You are a bounded Kimi implementation worker controlled by Codex. Use ONLY the supplied scoped MCP file tools. No shell, internet browsing, external files, recursive agents, credentials, deployment, package install, or Git commands. Read .agents/architecture.md and the task entry_files. All paths are relative to project. Implement the task completely within allowed_files. Tests will be run externally by the controller. Write result.json at the task output path with status candidate_success (never verified_success), changed_files, validation_not_run, assumptions, remaining. Write a checkpoint early and when nearing limits. The file tools enforce scope. Finish with a short summary. Node built-ins must use the node: prefix (e.g. node:sqlite). Files may have CRLF line endings; read before replacing text.\n',
);
const agent = path.join(artifacts, 'agent.yaml');
fs.writeFileSync(
  agent,
  `version: 1\nagent:\n  name: scoped-worker\n  system_prompt_path: ${JSON.stringify(promptPath.replaceAll('\\', '/'))}\n  tools: []\n`,
);
const mcp = path.join(artifacts, 'mcp.json');
fs.writeFileSync(
  mcp,
  JSON.stringify({
    mcpServers: {
      workspace: {
        command: process.execPath,
        args: [path.join(project, 'tools', 'worker-fs.ts'), work, taskPath],
      },
    },
  }),
);
const skills = path.join(artifacts, 'empty-skills');
fs.mkdirSync(skills, { recursive: true });
const sessionId = task.session_id ?? randomUUID();

interface RunOutcome {
  exitCode: number | null;
  timedOut: boolean;
  rawPath: string;
}
const launch = (prompt: string, resume: boolean, tag: string): Promise<RunOutcome> =>
  new Promise((resolve, reject) => {
    const rawPath = path.join(artifacts, tag + '.jsonl');
    const stdout = fs.openSync(rawPath, 'w');
    const stderr = fs.openSync(path.join(artifacts, tag + '.stderr.log'), 'w');
    const args = [
      ...(resume ? ['-r', sessionId] : ['--session', sessionId]),
      '--work-dir',
      work,
      '--agent-file',
      agent,
      '--mcp-config-file',
      mcp,
      '--skills-dir',
      skills,
      ...(task.no_thinking ? ['--no-thinking'] : []),
      '--print',
      '--output-format',
      'stream-json',
      '--max-steps-per-turn',
      '80',
      '--max-retries-per-step',
      '2',
      '--prompt',
      prompt,
    ];
    const child: ChildProcess = spawn('kimi.exe', args, {
      cwd: work,
      windowsHide: true,
      stdio: ['ignore', stdout, stderr],
      env: utf8Env,
    });
    fs.appendFileSync(
      path.join(artifacts, 'running.json'),
      JSON.stringify({
        pid: child.pid,
        task: task.task_id,
        session_id: sessionId,
        attempt: tag,
        started_at: new Date().toISOString(),
        worktree,
      }) + '\n',
    );
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        env: utf8Env,
      });
    }, task.budget.max_minutes * 60000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      fs.closeSync(stdout);
      fs.closeSync(stderr);
      resolve({ exitCode: code, timedOut, rawPath });
    });
  });

const runChecks = () => {
  const checks: { name: string; exit_code: number | null; passed: boolean }[] = [];
  for (const check of task.verifier ?? []) {
    const r = spawnSync(process.execPath, check.args, {
      cwd: work,
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
      env: utf8Env,
    });
    fs.writeFileSync(
      path.join(artifacts, check.name + '.log'),
      (r.stdout ?? '') + (r.stderr ?? ''),
    );
    checks.push({ name: check.name, exit_code: r.status, passed: r.status === 0 });
  }
  return checks;
};

const parseUsage = (rawPath: string) => {
  try {
    let input = 0,
      output = 0,
      found = false;
    for (const line of fs.readFileSync(rawPath, 'utf8').split('\n')) {
      const m = line.match(
        /"usage"\s*:\s*\{[^}]*"input[^"]*"\s*:\s*(\d+)[^}]*"output[^"]*"\s*:\s*(\d+)/,
      );
      if (m) {
        found = true;
        input += Number(m[1]);
        output += Number(m[2]);
      }
    }
    return found ? { input, output } : null;
  } catch {
    return null;
  }
};

const started = Date.now();
const usage = { input: 0, output: 0 };
let outcome = await launch(JSON.stringify(task), false, 'raw');
let u = parseUsage(outcome.rawPath);
if (u) {
  usage.input += u.input;
  usage.output += u.output;
}
let checks = outcome.exitCode === 0 ? runChecks() : [];
const maxAttempts = 1 + (task.budget.max_retries ?? 0);
for (
  let attempt = 2;
  attempt <= maxAttempts && (outcome.exitCode !== 0 || checks.some((c) => !c.passed));
  attempt++
) {
  const failing = checks
    .filter((c) => !c.passed)
    .map(
      (c) =>
        `${c.name} (exit ${c.exit_code}):\n${fs.readFileSync(path.join(artifacts, c.name + '.log'), 'utf8').slice(-3000)}`,
    )
    .join('\n\n');
  const repair = JSON.stringify({
    repair_attempt: attempt - 1,
    task_id: task.task_id,
    instruction:
      'Previous attempt failed external verification. Fix the failing checks within the same allowed_files scope. Do not rewrite working parts.',
    cli_exit_code: outcome.exitCode,
    failing_checks:
      failing || '(CLI crashed before checks ran; review your previous output for the cause)',
  });
  outcome = await launch(repair, true, 'repair-' + (attempt - 1));
  u = parseUsage(outcome.rawPath);
  if (u) {
    usage.input += u.input;
    usage.output += u.output;
  }
  if (outcome.exitCode === 0) checks = runChecks();
}

const changed = run('git', ['status', '--porcelain', '--untracked-files=all'], worktree)
  .split('\n')
  .filter(Boolean)
  .map((s) => s.slice(3).replaceAll('\\', '/'));
const allowed = (file: string) =>
  task.scope.allowed_files.some((r: string) =>
    r.endsWith('/**') ? file.startsWith(r.slice(0, -2)) : file === r,
  );
const violations = changed.filter(
  (f) => !f.startsWith(relativeProject + '/') || !allowed(f.slice(relativeProject.length + 1)),
);
let commit: null | string = null;
if (!violations.length && changed.length) {
  run('git', ['add', '--', ...changed], worktree);
  run(
    'git',
    [
      '-c',
      'user.name=Codex Worker',
      '-c',
      'user.email=worker@local.invalid',
      'commit',
      '-m',
      task.task_id + ' candidate delivery',
    ],
    worktree,
  );
  commit = run('git', ['rev-parse', 'HEAD'], worktree);
}
const diffLines = Number(
  run('git', ['diff', '--numstat', baseCommit, 'HEAD'], worktree)
    .split('\n')
    .reduce((n, line) => {
      const a = line.split('\t');
      return n + (Number(a[0]) || 0) + (Number(a[1]) || 0);
    }, 0),
);
const verified = outcome.exitCode === 0 && !violations.length && checks.every((c) => c.passed);
const summary = {
  task_id: task.task_id,
  status: verified ? 'candidate_success' : 'needs_review',
  exit_code: outcome.exitCode,
  timed_out: outcome.timedOut,
  duration_seconds: Math.round((Date.now() - started) / 1000),
  kimi_tokens: usage.input + usage.output || null,
  token_usage: usage.input || usage.output ? usage : undefined,
  cost: null,
  tool_calls: null,
  base_commit: baseCommit,
  commit,
  changed_files: changed,
  scope_violations: violations,
  diff_lines: diffLines,
  budget_exceeded:
    changed.length > task.budget.max_files_changed || diffLines > task.budget.max_diff_lines,
  checks,
  requires_codex_review: task.risk === 'high' || task.risk === 'critical',
  os_sandbox: false,
  tool_scope_enforced: true,
};
fs.mkdirSync(path.join(project, '.agents', 'results'), { recursive: true });
fs.writeFileSync(
  path.join(project, '.agents', 'results', task.task_id + '.json'),
  JSON.stringify(summary, null, 2),
);
process.stdout.write(JSON.stringify(summary) + '\n');
