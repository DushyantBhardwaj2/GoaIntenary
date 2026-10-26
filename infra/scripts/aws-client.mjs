import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../..', import.meta.url));
export const region = process.env.AWS_REGION || 'ap-south-1';
const bundled = path.join(root, '.tools', 'aws-cli', 'Amazon', 'AWSCLIV2', 'aws.exe');
export const cli = process.env.GOA_AWS_CLI || (existsSync(bundled) ? bundled : 'aws');

export function command(executable, args, { cwd = root, env = {}, inherit = false, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true,
      env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off', ...env },
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    if (!inherit) {
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
    }
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Required executable could not start.')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.match(/\(([A-Za-z][A-Za-z0-9.]+)\) when calling/)?.[1] || `Command failed (${code ?? 'timeout'}); provider details suppressed.`));
    });
  });
}

export async function aws(service, operation, args = [], { profile = process.env.AWS_PROFILE || 'goa-dev', requestRegion = region, text = false, timeout = 120_000 } = {}) {
  const output = await command(cli, [service, operation, ...args, '--profile', profile,
    '--region', requestRegion, '--output', text ? 'text' : 'json', '--no-cli-pager',
    '--cli-connect-timeout', '10', '--cli-read-timeout', '60'], { timeout });
  return text ? output.trim() : output.trim() ? JSON.parse(output) : {};
}
