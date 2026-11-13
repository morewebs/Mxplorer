import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compareVersions} from './release-feed.mjs';

export async function setBuildVersion(root, version) {
  compareVersions(version, version);
  for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
    const path = join(root, file);
    const value = JSON.parse(await readFile(path, 'utf8'));
    value.version = version;
    if (value.packages?.['']) value.packages[''].version = version;
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  for (const file of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
    const path = join(root, file);
    const text = await readFile(path, 'utf8');
    const pattern = file.endsWith('.lock')
      ? /(\[\[package\]\]\r?\nname = "mxplorer"\r?\nversion = ")[^"]+(")/
      : /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m;
    if (!pattern.test(text)) throw new Error(`Cannot find Mxplorer package version in ${file}`);
    await writeFile(path, text.replace(pattern, (_, before, after) => `${before}${version}${after}`));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await setBuildVersion(process.cwd(), process.argv[2]);
}
