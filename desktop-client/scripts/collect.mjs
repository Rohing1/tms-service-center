import { readdir, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
const [target, label, ...extensions] = process.argv.slice(2);
if (!target || !label || !extensions.length) throw new Error('Usage: collect target label extension...');
const root = path.resolve('src-tauri/target', target, 'release/bundle');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]))).flat();
}
const files = await walk(root);
await mkdir('artifacts', { recursive: true });
for (const ext of extensions) {
  const matches = files.filter(f => f.endsWith(`.${ext}`));
  if (matches.length !== 1) throw new Error(`Expected one .${ext} for ${label}, got ${matches.length}`);
  const name = `TMS-Desktop-1.0.0-${label}.${ext}`;
  await copyFile(matches[0], path.join('artifacts', name));
  console.log(name);
}
