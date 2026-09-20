// Minimal stdio MCP: workers can inspect project files and edit only task-owned paths.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const root = fs.realpathSync(process.argv[2] ?? '.');
const task = JSON.parse(fs.readFileSync(process.argv[3] ?? '', 'utf8'));
const allowed: string[] = task.scope.allowed_files;
const denied = new Set([
  '.git',
  'node_modules',
  '.env',
  'private',
  'artifacts',
  'dist',
  'dist-server',
  '.kimi',
  '.kimi-code',
]);
function matches(file: string, rule: string): boolean {
  return rule.endsWith('/**') ? file.startsWith(rule.slice(0, -2)) : file === rule;
}
function checked(file: string, writing = false): string {
  if (typeof file !== 'string' || path.isAbsolute(file) || file.includes(':'))
    throw new Error('Relative project paths required');
  const parts = file.replaceAll('\\', '/').split('/');
  if (
    parts.some(
      (p) =>
        p === '..' ||
        denied.has(p.toLowerCase()) ||
        (p.toLowerCase().startsWith('.env') && p.toLowerCase() !== '.env.example'),
    )
  )
    throw new Error('Path denied');
  const normalized = parts.filter((p) => p && p !== '.').join('/');
  if (writing && !allowed.some((p) => matches(normalized, p)))
    throw new Error('Write outside task scope');
  const full = path.resolve(root, normalized);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Outside worktree');
  let current = root;
  for (const part of normalized.split('/').filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error('Symlinks/junctions denied');
  }
  return full;
}
function files(dir = ''): string[] {
  const all: string[] = [];
  for (const item of fs.readdirSync(checked(dir), { withFileTypes: true })) {
    if (
      denied.has(item.name.toLowerCase()) ||
      item.isSymbolicLink() ||
      item.name.toLowerCase().startsWith('.env')
    )
      continue;
    const child = dir ? `${dir}/${item.name}` : item.name;
    if (item.isDirectory()) all.push(...files(child));
    else all.push(child);
    if (all.length > 2500) break;
  }
  return all;
}
const schema = (properties: object, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const str = { type: 'string' };
const tools = [
  {
    name: 'list_files',
    description: 'List relative project files. Optional path narrows subtree.',
    inputSchema: schema({ path: str }, []),
  },
  {
    name: 'read_file',
    description: 'Read UTF-8 file, optional 1-based start and number of lines.',
    inputSchema: schema({ path: str, start: { type: 'integer' }, lines: { type: 'integer' } }, [
      'path',
    ]),
  },
  {
    name: 'search',
    description:
      'Literal text search in project. Optional path narrows subtree. Max 80 matching lines.',
    inputSchema: schema({ text: str, path: str }, ['text']),
  },
  {
    name: 'write_file',
    description: 'Create/overwrite UTF-8 file within task allowed_files. No shell execution.',
    inputSchema: schema({ path: str, content: str }, ['path', 'content']),
  },
  {
    name: 'replace_text',
    description: 'Replace exactly one occurrence in an allowed file; fails if ambiguous.',
    inputSchema: schema({ path: str, old: str, replacement: str }, ['path', 'old', 'replacement']),
  },
];
function call(name: string, args: Record<string, unknown>): unknown {
  const file = String(args.path ?? '');
  if (name === 'list_files') return files(file);
  if (name === 'read_file') {
    const content = fs.readFileSync(checked(file), 'utf8').split('\n');
    const start = Math.max(0, Number(args.start ?? 1) - 1);
    return content
      .slice(start, start + Math.min(Number(args.lines ?? 250), 1000))
      .map((s, i) => `${start + i + 1}: ${s}`)
      .join('\n');
  }
  if (name === 'search') {
    const found: string[] = [];
    for (const f of files(file)) {
      if (fs.statSync(checked(f)).size > 500000) continue;
      fs.readFileSync(checked(f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes(String(args.text)) && found.length < 80)
            found.push(`${f}:${i + 1}: ${line.slice(0, 350)}`);
        });
      if (found.length >= 80) break;
    }
    return found;
  }
  const target = checked(file, true);
  let content: string;
  if (name === 'write_file') content = String(args.content);
  else if (name === 'replace_text') {
    const old = String(args.old);
    content = fs.readFileSync(target, 'utf8');
    if (!old || content.split(old).length !== 2) throw new Error('Expected exactly one match');
    content = content.replace(old, String(args.replacement));
  } else throw new Error('Unknown tool');
  if (content.length > 150000) throw new Error('File too large');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return { written: file };
}
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let request: {
    id?: unknown;
    method: string;
    params?: { name: string; arguments: Record<string, unknown> };
  };
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === undefined) return;
  let result: unknown;
  try {
    if (request.method === 'initialize')
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'scoped-worker-files', version: '1.0.0' },
      };
    else if (request.method === 'tools/list') result = { tools };
    else if (request.method === 'tools/call')
      result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(call(request.params?.name ?? '', request.params?.arguments ?? {})),
          },
        ],
      };
    else if (request.method === 'ping') result = {};
    else throw new Error('Unsupported method');
  } catch (error) {
    result = {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool error' }],
    };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
