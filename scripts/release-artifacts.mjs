import {createHash} from 'node:crypto';
import {readFile, writeFile, readdir, mkdir, copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RELEASE_ROOT, validatePayload, verifyBytes} from './release-feed.mjs';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export async function prepareArtifacts({output, destination, channel, version, tag, metadata}) {
  const feed = JSON.parse(await readFile(join(output, `releases.${channel}.json`), 'utf8'));
  const assets = feed.Assets.filter(x => x.Version === version && ['Full', 'Delta'].includes(x.Type)).map(x => {
    const asset = {...x, NotesMarkdown: x.NotesMarkdown ?? '', NotesHtml: x.NotesHtml ?? x.NotesHTML ?? ''};
    delete asset.NotesHTML;
    return {asset, url: `${RELEASE_ROOT}${tag}/${encodeURIComponent(asset.FileName)}`};
  });
  validatePayload({schema: 1, channel, publishedAt: new Date().toISOString(), assets}, channel);
  if (assets.filter(x => x.asset.Type === 'Full').length !== 1) throw new Error('Exactly one full package is required');
  await mkdir(destination, {recursive: true});
  for (const {asset} of assets) {
    verifyBytes(await readFile(join(output, asset.FileName)), asset);
    await copyFile(join(output, asset.FileName), join(destination, asset.FileName));
  }
  const files = await readdir(output);
  const installers = files.filter(x => /Setup\.exe$/i.test(x));
  const portable = files.filter(x => /Portable\.zip$/i.test(x));
  if (installers.length !== 1 || portable.length !== 1) throw new Error('Expected one managed Setup.exe and Portable.zip');
  for (const name of [...installers, ...portable]) await copyFile(join(output, name), join(destination, name));
  const baseline = JSON.parse(await readFile(metadata, 'utf8'));
  await writeFile(join(destination, 'release-manifest.json'), `${JSON.stringify({channel, version, tag, baselineVersion: baseline.baselineVersion, assets}, null, 2)}\n`);
  const checksums = [];
  for (const name of (await readdir(destination)).sort()) {
    if (name === 'SHA256SUMS.txt') continue;
    checksums.push(`${sha256(await readFile(join(destination, name)))} *${name}`);
  }
  await writeFile(join(destination, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
  return checkArtifacts(destination);
}
export async function checkArtifacts(directory) {
  const checksumText = await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8');
  const expected = new Set(['SHA256SUMS.txt']);
  for (const line of checksumText.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) \*([A-Za-z0-9_.-]+)$/.exec(line);
    if (!match || expected.has(match[2]) || match[2].includes('..')) throw new Error('Invalid checksum manifest');
    expected.add(match[2]);
    if (sha256(await readFile(join(directory, match[2]))) !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
  }
  const actual = await readdir(directory);
  if (actual.length !== expected.size || actual.some(name => !expected.has(name))) throw new Error('Unexpected or missing artifact');
  const manifest = JSON.parse(await readFile(join(directory, 'release-manifest.json'), 'utf8'));
  validatePayload({schema: 1, channel: manifest.channel, publishedAt: new Date().toISOString(), assets: manifest.assets}, manifest.channel);
  if (manifest.assets.some(x => x.asset.Version !== manifest.version || !x.url.includes(`/download/${manifest.tag}/`))) throw new Error('Artifact release mismatch');
  for (const {asset} of manifest.assets) verifyBytes(await readFile(join(directory, asset.FileName)), asset);
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'prepare') {
    const [output, destination, channel, version, tag, metadata] = args;
    await prepareArtifacts({output, destination, channel, version, tag, metadata});
  } else if (command === 'check') await checkArtifacts(args[0]);
  else throw new Error('Usage: release-artifacts.mjs prepare OUTPUT DEST CHANNEL VERSION TAG METADATA | check DIRECTORY');
}
