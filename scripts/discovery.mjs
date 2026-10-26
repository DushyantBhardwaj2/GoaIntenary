import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const service = path.join(root, 'services', 'discovery');
const executable = path.join(service, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args, cwd = service) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.on('error', () => reject(new Error('Python could not start. Install Python 3.11 or newer, or set GOA_PYTHON to its executable.')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Python operation failed with exit ${code}.`)));
  });
}
if (process.argv.includes('--setup')) {
  const python = process.env.GOA_PYTHON || 'python';
  await run(python, ['-c', 'import sys; assert sys.version_info >= (3,11), "Python 3.11+ required"']);
  if (!existsSync(executable)) await run(python, ['-m', 'venv', '.venv']);
  await run(executable, ['-m', 'pip', 'install', '--disable-pip-version-check', '--cache-dir', path.join(root, '.data', 'pip-cache'), '-r', 'requirements-lock.txt']);
} else {
  if (!existsSync(executable)) throw new Error('Run npm run setup:discovery before testing the public API.');
  await run(executable, ['-m', 'pytest', '-q']);
}
