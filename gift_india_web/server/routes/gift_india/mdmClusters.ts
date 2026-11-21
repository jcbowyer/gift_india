import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const API_DIR = path.join(REPO_ROOT, 'gift_india_api');

async function resolvePython(): Promise<string> {
  const venvPython = path.join(REPO_ROOT, '.venv/bin/python');
  try {
    await access(venvPython);
    return venvPython;
  } catch {
    return 'python3';
  }
}

export function runApplyMergeClusters(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return resolvePython().then(
    (python) =>
      new Promise((resolve) => {
        const child = spawn(python, ['-m', 'src.apply_merge_reviews'], {
          cwd: API_DIR,
          env: { ...process.env },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      }),
  );
}
