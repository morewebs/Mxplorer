import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {REPOSITORY, MAX_FEED_BYTES, verifyEnvelope} from './release-feed.mjs';
import {githubApi} from './release-publish.mjs';

export async function stagePages({directory, publicKey, api = githubApi}) {
  const staged = [];
  for (const channel of ['stable', 'nightly']) {
    let file;
    try { file = await api('GET', `repos/${REPOSITORY}/contents/${channel}.json?ref=update-feed`); }
    catch (error) { if (error.status === 404) continue; throw error; }
    const bytes = Buffer.from(file.content, 'base64');
    if (bytes.length > MAX_FEED_BYTES) throw new Error('Canonical feed exceeds size bound');
    verifyEnvelope(JSON.parse(bytes.toString('utf8')), publicKey, channel);
    staged.push({channel, bytes});
  }
  if (!staged.length) throw new Error('No authenticated channel feeds are available for Pages');
  await mkdir(directory, {recursive: true});
  if ((await readdir(directory)).length) throw new Error('Pages staging directory must be empty');
  for (const {channel, bytes} of staged) await writeFile(join(directory, `${channel}.json`), bytes);
  await writeFile(join(directory, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Mxplorer updates</title><h1>Signed Mxplorer update feeds</h1><ul>' + staged.map(({channel}) => `<li><a href="${channel}.json">${channel}</a></li>`).join('') + '</ul></html>\n');
  return staged.map(x => x.channel);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const publicKey = await readFile('src-tauri/update-public-key.txt', 'utf8');
  const channels = await stagePages({directory: process.argv[2] ?? 'pages-feed', publicKey});
  console.log(`Staged authenticated Pages feeds: ${channels.join(', ')}`);
}
