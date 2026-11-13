import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, readdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkArtifacts} from './release-artifacts.mjs';
import {REPOSITORY, verifyEnvelope, makeEnvelope, mergeFeed, latestFull, compareVersions} from './release-feed.mjs';

export function immutableUploadPlan(expected, existing, draft) {
  for (const asset of existing) {
    const local = expected.find(x => x.name === asset.name);
    if (!local) throw new Error(`Unexpected immutable asset: ${asset.name}`);
    if (local.size !== asset.size || (asset.digest && local.digest !== asset.digest)) throw new Error(`Immutable asset differs: ${asset.name}`);
  }
  const missing = expected.filter(x => !existing.some(y => y.name === x.name)).map(x => x.name);
  if (!draft && missing.length) throw new Error('Published immutable release is incomplete; refusing replacement');
  return missing;
}
const API_ROOT = `repos/${REPOSITORY}`;
function missing(error) { return error.status === 404; }
async function ensureFeedBranch(api) {
  try { await api('GET', `${API_ROOT}/git/ref/heads/update-feed`); return; }
  catch (error) { if (!missing(error)) throw error; }
  // The metadata branch deliberately has no source-history parent or application files.
  const tree = await api('POST', `${API_ROOT}/git/trees`, {tree: [{path: 'README.md', mode: '100644', type: 'blob', content: '# Mxplorer signed update feeds\n\nStable and nightly envelopes; packages live in immutable GitHub releases.\n'}]});
  const commit = await api('POST', `${API_ROOT}/git/commits`, {message: 'Initialize signed update metadata', tree: tree.sha, parents: []});
  try { await api('POST', `${API_ROOT}/git/refs`, {ref: 'refs/heads/update-feed', sha: commit.sha}); }
  catch (error) {
    if (error.status !== 422) throw error;
    // Another initialization can win; only proceed after proving the branch now exists.
    await api('GET', `${API_ROOT}/git/ref/heads/update-feed`);
  }
}
export async function publishChannelPointer({manifest, publicKey, pem, api, markLatest}) {
  await ensureFeedBranch(api);
  const endpoint = `${API_ROOT}/contents/${manifest.channel}.json`;
  const readEndpoint = `${endpoint}?ref=update-feed`;
  let previous = null, currentFile = null;
  try { currentFile = await api('GET', readEndpoint); }
  catch (error) { if (!missing(error)) throw error; }
  if (currentFile) previous = verifyEnvelope(JSON.parse(Buffer.from(currentFile.content, 'base64').toString('utf8')), publicKey, manifest.channel);
  const latest = latestFull(previous);
  const ordering = latest ? compareVersions(manifest.version, latest.asset.Version) : 1;
  if (ordering < 0) return {advanced: false, repairedLatest: false};
  if (ordering === 0) {
    // A prior attempt may have committed the feed and failed before marking stable latest.
    if (manifest.channel === 'stable') await markLatest(manifest.tag);
    return {advanced: false, repairedLatest: manifest.channel === 'stable'};
  }
  const payload = mergeFeed(previous, manifest.assets, {channel: manifest.channel, baselineVersion: manifest.baselineVersion});
  const envelope = makeEnvelope(payload, pem);
  verifyEnvelope(envelope, publicKey, manifest.channel);
  const bytes = Buffer.from(`${JSON.stringify(envelope)}\n`);
  const request = {message: `Publish ${manifest.channel} ${manifest.version}`, branch: 'update-feed', content: bytes.toString('base64')};
  if (currentFile) request.sha = currentFile.sha;
  // Contents API writes a single atomic Git commit. Stale blob sha fails without removing the old feed.
  await api('PUT', endpoint, request);
  const published = await api('GET', readEndpoint);
  const actual = Buffer.from(published.content, 'base64');
  if (!actual.equals(bytes)) throw new Error('Published pointer differs from signed envelope');
  verifyEnvelope(JSON.parse(actual.toString('utf8')), publicKey, manifest.channel);
  if (manifest.channel === 'stable') await markLatest(manifest.tag);
  return {advanced: true, repairedLatest: false};
}
function gh(args, options = {}) {
  return execFileSync('gh', args, {encoding: 'utf8', windowsHide: true, ...options});
}
export async function githubApi(method, endpoint, body) {
  const args = ['api', endpoint, '--method', method];
  if (body !== undefined) args.push('--input', '-');
  try {
    return JSON.parse(gh(args, {input: body === undefined ? undefined : JSON.stringify(body), stdio: ['pipe', 'pipe', 'pipe']}));
  } catch (error) {
    const status = /HTTP (\d{3})/.exec(String(error.stderr));
    if (status) error.status = Number(status[1]);
    throw error;
  }
}
function releaseByTag(tag) {
  try { return JSON.parse(gh(['api', `repos/${REPOSITORY}/releases/tags/${tag}`], {stdio: ['ignore', 'pipe', 'pipe']})); }
  catch (error) {
    if (/HTTP 404/.test(String(error.stderr))) return null;
    throw error;
  }
}
async function verifyRemoteRelease(manifest, directory) {
  const remote = releaseByTag(manifest.tag);
  if (!remote || remote.draft) throw new Error('Immutable release must be published before the channel pointer');
  const expected = [];
  for (const name of await readdir(directory)) {
    const bytes = await readFile(join(directory, name));
    expected.push({name, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`});
  }
  immutableUploadPlan(expected, remote.assets, false);
  // Older GitHub assets may lack a server digest; verify downloaded bytes as well.
  const downloaded = await mkdtemp(join(tmpdir(), 'mxplorer-remote-'));
  gh(['release', 'download', manifest.tag, '--repo', REPOSITORY, '--dir', downloaded]);
  await checkArtifacts(downloaded);
  for (const file of expected) {
    const hash = `sha256:${createHash('sha256').update(await readFile(join(downloaded, file.name))).digest('hex')}`;
    if (hash !== file.digest) throw new Error(`Remote immutable asset differs: ${file.name}`);
  }
}
async function publishImmutable(directory) {
  const manifest = await checkArtifacts(directory);
  let remote = releaseByTag(manifest.tag);
  if (!remote) {
    const notes = `Windows x64 managed Setup and portable ZIP. Existing standalone copies need one full managed installation to enable updates. Binaries are not Authenticode signed. Commit: ${process.env.GITHUB_SHA}.`;
    const args = ['release', 'create', manifest.tag, '--repo', REPOSITORY, '--draft', '--latest=false', '--title', `Mxplorer ${manifest.version}`, '--notes', notes];
    if (manifest.channel === 'nightly') args.push('--prerelease', '--target', process.env.GITHUB_SHA);
    else args.push('--verify-tag');
    gh(args);
    remote = releaseByTag(manifest.tag);
  }
  const expected = [];
  for (const name of await readdir(directory)) {
    const bytes = await readFile(join(directory, name));
    expected.push({name, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`});
  }
  const missing = immutableUploadPlan(expected, remote.assets, remote.draft);
  if (missing.length) gh(['release', 'upload', manifest.tag, '--repo', REPOSITORY, ...missing.map(name => join(directory, name))]);
  if (remote.draft) {
    // Verify all bytes while still draft; only complete releases become visible.
    const downloaded = await mkdtemp(join(tmpdir(), 'mxplorer-draft-'));
    gh(['release', 'download', manifest.tag, '--repo', REPOSITORY, '--dir', downloaded]);
    await checkArtifacts(downloaded);
    for (const file of expected) {
      if (`sha256:${createHash('sha256').update(await readFile(join(downloaded, file.name))).digest('hex')}` !== file.digest) throw new Error(`Draft asset differs: ${file.name}`);
    }
    gh(['release', 'edit', manifest.tag, '--repo', REPOSITORY, '--draft=false', '--latest=false']);
  }
  await verifyRemoteRelease(manifest, directory);
  console.log(`Immutable release ${manifest.tag} verified.`);
}
async function publishPointer(directory) {
  const manifest = await checkArtifacts(directory);
  await verifyRemoteRelease(manifest, directory);
  const publicKey = await readFile('src-tauri/update-public-key.txt', 'utf8');
  const result = await publishChannelPointer({manifest, publicKey, pem: process.env.MXPLORER_UPDATE_SIGNING_KEY, api: githubApi,
    markLatest: async tag => { gh(['release', 'edit', tag, '--repo', REPOSITORY, '--latest']); }});
  console.log(`${result.advanced ? 'Published' : 'Preserved'} signed ${manifest.channel} pointer for ${manifest.version}${result.repairedLatest ? ' and repaired stable latest' : ''}.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, directory] = process.argv.slice(2);
  if (command === 'immutable') await publishImmutable(resolve(directory));
  else if (command === 'pointer') await publishPointer(resolve(directory));
  else throw new Error('Usage: release-publish.mjs immutable|pointer ARTIFACT_DIRECTORY');
}
