import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { command, root } from './aws-client.mjs';

export async function packageProvider() {
  const directory = path.join(root, 'infra/artifacts/database-provider');
  await mkdir(directory, { recursive: true });
  await build({ entryPoints: [path.join(root, 'infra/scripts/database-provider.mjs')], outfile: path.join(directory, 'index.js'),
    bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
  const archive = path.join(root, 'infra/artifacts/database-provider.zip');
  await command(process.env.GOA_PYTHON || 'python', ['-c',
    'import pathlib,sys,zipfile; base=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w"); info=zipfile.ZipInfo("index.js",date_time=(2026,1,1,0,0,0)); z.writestr(info,(base/"index.js").read_bytes(),compress_type=zipfile.ZIP_DEFLATED); z.close()', directory, archive]);
  const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
  return { file: archive, key: `builds/${hash}/database-provider.zip` };
}
