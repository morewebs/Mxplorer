import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync} from 'node:crypto';
import {immutableUploadPlan, publishChannelPointer, releaseByTag} from './release-publish.mjs';
import {makeEnvelope, verifyEnvelope} from './release-feed.mjs';

test('draft lookup resolves a release id when GitHub tag REST lookup cannot see the draft',()=>{
  const draft={id:42,tag_name:'nightly-0.3.1-nightly.2.1',draft:true,assets:[]};
  const cli=args=>{
    if(args[0]==='release'&&args[1]==='view')return JSON.stringify({apiUrl:'https://api.github.com/repos/morewebs/Mxplorer/releases/42'});
    if(args[0]==='api'&&args[1]==='https://api.github.com/repos/morewebs/Mxplorer/releases/42')return JSON.stringify(draft);
    throw Object.assign(new Error('Not found'),{stderr:'gh: Not Found (HTTP 404)'});
  };
  assert.deepEqual(releaseByTag(draft.tag_name,cli),draft);
});

test('only a missing release permits creation, not a failed authenticated lookup',()=>{
  assert.equal(releaseByTag('v0.3.0',()=>{throw Object.assign(new Error('missing'),{stderr:'release not found'});}),null);
  assert.throws(()=>releaseByTag('v0.3.0',()=>{throw Object.assign(new Error('denied'),{stderr:'HTTP 403'});}),/denied/);
});
import {stagePages} from './release-pages.mjs';
import {mkdtemp, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('immutable release resume uploads missing files and rejects replacement or extra files', () => {
  const expected = [{name: 'Setup.exe', size: 5, digest: 'sha256:abc'}, {name: 'package.nupkg', size: 9, digest: 'sha256:def'}];
  assert.deepEqual(immutableUploadPlan(expected, [{name: 'Setup.exe', size: 5, digest: 'sha256:abc'}], true), ['package.nupkg']);
  assert.throws(() => immutableUploadPlan(expected, [{name: 'Setup.exe', size: 5, digest: 'sha256:changed'}], true), /immutable/i);
  assert.throws(() => immutableUploadPlan(expected, [{name: 'unknown.exe', size: 1, digest: 'sha256:z'}], true), /unexpected/i);
  assert.throws(() => immutableUploadPlan(expected, [], false), /incomplete/i);
});

const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const rawKey = publicKey.export({format: 'der', type: 'spki'}).subarray(-32).toString('base64');
const pem = privateKey.export({format: 'pem', type: 'pkcs8'});
const manifest = version => ({channel: 'stable', version, tag: `v${version}`, baselineVersion: null, assets: [{asset: {PackageId: 'Mxplorer', Version: version, Type: 'Full', FileName: `Mxplorer-${version}-full.nupkg`, SHA1: 'a'.repeat(40), SHA256: 'b'.repeat(64), Size: 42, NotesMarkdown: '', NotesHtml: ''}, url: `https://github.com/morewebs/Mxplorer/releases/download/v${version}/Mxplorer-${version}-full.nupkg`}]});
const signed = version => makeEnvelope({schema: 1, channel: 'stable', publishedAt: '2026-11-13T00:00:00Z', assets: manifest(version).assets}, pem);
const httpError = status => Object.assign(new Error(`HTTP ${status}`), {status});

// An in-memory GitHub Contents/Git API boundary implements atomic writes and blob-sha conflicts.
// Assertions below inspect the stored signed feed, never calls to this fake.
function githubFixture(initial = {}, {branch = true, failWrite = false, conflict = false} = {}) {
  const files = new Map(Object.entries(initial).map(([name, value]) => [name, Buffer.from(JSON.stringify(value))]));
  let branchExists = branch;
  let orphanTree, orphanCommit;
  const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  return {files, api: async (method, endpoint, body) => {
    if (endpoint.endsWith('/git/ref/heads/update-feed')) {
      if (!branchExists) throw httpError(404);
      return {object: {sha: 'branch-head'}};
    }
    if (endpoint.endsWith('/git/trees') && method === 'POST') {
      assert.equal(body.tree.length, 1);
      assert.equal(body.tree[0].path, 'README.md');
      assert.equal(body.base_tree, undefined);
      orphanTree = true; return {sha: 'orphan-tree'};
    }
    if (endpoint.endsWith('/git/commits') && method === 'POST') {
      assert.equal(orphanTree, true);
      assert.deepEqual(body.parents, []);
      orphanCommit = true; return {sha: 'orphan-commit'};
    }
    if (endpoint.endsWith('/git/refs') && method === 'POST') {
      assert.equal(orphanCommit, true);
      assert.equal(body.ref, 'refs/heads/update-feed');
      branchExists = true; return {ref: body.ref};
    }
    const match = /\/contents\/(stable|nightly)\.json(?:\?ref=update-feed)?$/.exec(endpoint);
    assert.ok(match, `Unexpected API route ${endpoint}`);
    const name = `${match[1]}.json`;
    if (method === 'GET') {
      if (!files.has(name)) throw httpError(404);
      const bytes = files.get(name);
      return {sha: blob(bytes), content: bytes.toString('base64')};
    }
    assert.equal(method, 'PUT');
    assert.equal(body.branch, 'update-feed');
    if (failWrite) throw httpError(500);
    if (conflict || body.sha !== (files.has(name) ? blob(files.get(name)) : undefined)) throw httpError(409);
    files.set(name, Buffer.from(body.content, 'base64'));
    return {content: {sha: blob(files.get(name))}};
  }};
}
test('atomic pointer publication stores a verifiable envelope and preserves the other channel', async () => {
  const fixture = githubFixture({'stable.json': signed('0.3.0'), 'nightly.json': {untouched: true}});
  await publishChannelPointer({manifest: manifest('0.3.1'), publicKey: rawKey, pem, api: fixture.api, markLatest: async () => {}});
  const published = verifyEnvelope(JSON.parse(fixture.files.get('stable.json')), rawKey, 'stable');
  assert.equal(published.assets.at(-1).asset.Version, '0.3.1');
  assert.deepEqual(JSON.parse(fixture.files.get('nightly.json')), {untouched: true});
});
test('a failed or conflicting atomic write leaves the valid channel bytes untouched', async () => {
  for (const failure of [{failWrite: true}, {conflict: true}]) {
    const fixture = githubFixture({'stable.json': signed('0.3.0')}, failure);
    const previous = fixture.files.get('stable.json');
    await assert.rejects(publishChannelPointer({manifest: manifest('0.3.1'), publicKey: rawKey, pem, api: fixture.api, markLatest: async () => {}}), /HTTP 409|HTTP 500/);
    assert.deepEqual(fixture.files.get('stable.json'), previous);
  }
});
test('stable reruns repair latest after an already successful feed write, but older runs preserve it', async () => {
  const fixture = githubFixture({'stable.json': signed('0.3.1')});
  let latest = 'v0.3.0';
  await publishChannelPointer({manifest: manifest('0.3.1'), publicKey: rawKey, pem, api: fixture.api, markLatest: async tag => {latest = tag;}});
  assert.equal(latest, 'v0.3.1');
  await publishChannelPointer({manifest: manifest('0.3.0'), publicKey: rawKey, pem, api: fixture.api, markLatest: async tag => {latest = tag;}});
  assert.equal(latest, 'v0.3.1');
});
test('initial publication creates an orphan metadata branch before committing the first signed feed', async () => {
  const fixture = githubFixture({}, {branch: false});
  await publishChannelPointer({manifest: manifest('0.3.0'), publicKey: rawKey, pem, api: fixture.api, markLatest: async () => {}});
  const published = verifyEnvelope(JSON.parse(fixture.files.get('stable.json')), rawKey, 'stable');
  assert.equal(published.assets[0].asset.Version, '0.3.0');
});
test('Pages staging copies both authenticated canonical channels byte-for-byte', async () => {
  const nightlyManifest = manifest('0.3.1-nightly.1.1');
  nightlyManifest.assets[0].url = nightlyManifest.assets[0].url.replace('/v0.3.1-nightly.1.1/', '/nightly-0.3.1-nightly.1.1/');
  const nightly = makeEnvelope({schema: 1, channel: 'nightly', publishedAt: '2026-11-13T00:00:00Z', assets: nightlyManifest.assets}, pem);
  const fixture = githubFixture({'stable.json': signed('0.3.0'), 'nightly.json': nightly});
  const directory = await mkdtemp(join(tmpdir(), 'mxplorer-pages-'));
  await stagePages({directory, publicKey: rawKey, api: fixture.api});
  assert.deepEqual(await readFile(join(directory, 'stable.json')), fixture.files.get('stable.json'));
  assert.deepEqual(await readFile(join(directory, 'nightly.json')), fixture.files.get('nightly.json'));
});
test('Pages staging permits a missing first channel and rejects a bad signature before writing feeds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mxplorer-pages-'));
  const initial = githubFixture({'stable.json': signed('0.3.0')});
  await stagePages({directory, publicKey: rawKey, api: initial.api});
  assert.deepEqual((await readdir(directory)).filter(x => x.endsWith('.json')), ['stable.json']);
  const invalid = signed('0.3.1'); invalid.signature = Buffer.alloc(64).toString('base64');
  const corrupted = githubFixture({'stable.json': signed('0.3.0'), 'nightly.json': invalid});
  const failedDirectory = await mkdtemp(join(tmpdir(), 'mxplorer-pages-'));
  await assert.rejects(stagePages({directory: failedDirectory, publicKey: rawKey, api: corrupted.api}), /signature/i);
  assert.deepEqual(await readdir(failedDirectory), []);
});
