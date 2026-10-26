import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { command, root } from './aws-client.mjs';

const artifacts = path.join(root, 'infra', 'artifacts');
const buildDir = path.join(artifacts, `build-${Date.now()}`);
const core = path.join(buildDir, 'core'), discovery = path.join(buildDir, 'discovery');
const snapshot = path.join(buildDir, 'source');
await mkdir(path.join(core, 'dist'), { recursive: true });
await mkdir(discovery, { recursive: true });
async function sourceHash() {
  const hash = createHash('sha256');
  for (const base of ['services/core-api/src', 'services/core-api/migrations', 'services/discovery/app']) {
    const directory = path.join(root, base);
    const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
      .filter(file => file.isFile() && !file.parentPath.includes('__pycache__') && !file.name.endsWith('.pyc'))
      .map(file => path.join(file.parentPath, file.name)).sort();
    for (const file of files) { hash.update(path.relative(root, file)); hash.update(await readFile(file)); }
  }
  return hash.digest('hex');
}
const fingerprint = await sourceHash();
for (const base of ['services/core-api/src', 'services/core-api/migrations', 'services/discovery/app']) {
  await cp(path.join(root, base), path.join(snapshot, base), { recursive: true,
    filter: file => !file.includes('__pycache__') && !file.endsWith('.pyc') });
}
if (fingerprint !== await sourceHash()) throw new Error('Source changed during snapshot creation. Rerun packaging after the current editor save.');

await build({
  absWorkingDir: snapshot,
  entryPoints: { lambda: 'services/core-api/src/lambda.ts', 'migration-lambda': 'services/core-api/src/migration-lambda.ts' },
  outdir: path.join(core, 'dist'), bundle: true, platform: 'node', target: 'node22', format: 'esm',
  external: ['pg-native'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  plugins: [{ name: 'no-embedded-database-in-aws', setup(builder) {
    builder.onResolve({ filter: /^@electric-sql\/pglite$/ }, () => ({ path: 'pglite', namespace: 'aws-only' }));
    builder.onLoad({ filter: /.*/, namespace: 'aws-only' }, () => ({ contents: 'export class PGlite { static create() { throw new Error("Embedded storage is unavailable on AWS."); } }' }));
  } }],
});
await writeFile(path.join(core, 'package.json'), JSON.stringify({ type: 'module', private: true }));
await cp(path.join(snapshot, 'services/core-api/migrations'), path.join(core, 'migrations'), { recursive: true });

const python = process.env.GOA_PYTHON || 'python';
console.log('Packaging pinned Python dependencies for AWS Linux x86_64 / Python 3.11.');
await command(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:',
  '--platform', 'manylinux2014_x86_64', '--implementation', 'cp', '--python-version', '3.11',
  '--target', discovery, '--cache-dir', path.join(root, '.data/pip-cache'),
  '-r', path.join(root, 'services/discovery/requirements-lambda.txt')], { inherit: true, timeout: 600_000 });
await cp(path.join(snapshot, 'services/discovery/app'), path.join(discovery, 'app'), {
  recursive: true, filter: file => !file.includes('__pycache__') && !file.endsWith('.pyc'),
});
const manifest = { sourceFingerprint: fingerprint, createdAt: new Date().toISOString() };
for (const [name, directory] of [['core', core], ['discovery', discovery]]) {
  const zipPath = path.join(buildDir, `${name}.zip`);
  await command(python, ['-c',
    'import pathlib,sys,zipfile; base=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(f,f.relative_to(base).as_posix()) for f in sorted(base.rglob("*")) if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc"]; z.close()',
    directory, zipPath]);
  const archive = await readFile(zipPath);
  const hash = createHash('sha256').update(archive).digest('hex');
  manifest[name] = { file: zipPath, key: `builds/${hash}/${name}.zip`, sha256: hash, bytes: archive.length };
  console.log(`${name}: ${archive.length} bytes; SHA256 ${hash}`);
}
await writeFile(path.join(artifacts, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('AWS packages built; no uploads or cloud changes were made.');
