// @vitest-environment node
import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

it('worker MCP denies traversal, credentials, junctions and writes outside its task', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'paper2-worker-scope-'));
  const root = path.join(folder, 'work');
  const outside = path.join(folder, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(root, 'readme.md'), 'allowed content');
  writeFileSync(path.join(root, '.env'), 'synthetic forbidden credential');
  writeFileSync(path.join(outside, 'secret.txt'), 'synthetic outside data');
  symlinkSync(outside, path.join(root, 'junction'), 'junction');
  const task = path.join(folder, 'task.json');
  writeFileSync(task, JSON.stringify({ scope: { allowed_files: ['output/**'] } }));
  const requests = [
    { name: 'read_file', arguments: { path: 'readme.md' } },
    { name: 'read_file', arguments: { path: '../outside/secret.txt' } },
    { name: 'read_file', arguments: { path: '.ENV' } },
    { name: 'read_file', arguments: { path: 'junction/secret.txt' } },
    { name: 'write_file', arguments: { path: 'readme.md', content: 'unauthorized' } },
    { name: 'write_file', arguments: { path: 'output/result.txt', content: 'owned write' } },
  ];
  const input =
    requests
      .map((params, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params }))
      .join('\n') + '\n';
  const proc = spawnSync(process.execPath, [path.resolve('tools/worker-fs.ts'), root, task], {
    input,
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(proc.status).toBe(0);
  const rows = proc.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(rows[0].result.isError).not.toBe(true);
  for (const i of [1, 2, 3, 4]) expect(rows[i].result.isError).toBe(true);
  expect(rows[5].result.isError).not.toBe(true);
  expect(readFileSync(path.join(root, 'readme.md'), 'utf8')).toBe('allowed content');
  expect(readFileSync(path.join(root, 'output/result.txt'), 'utf8')).toBe('owned write');
});
