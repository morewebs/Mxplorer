import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {test} from 'node:test';
import {makeEnvelope, verifyEnvelope, mergeFeed, validatePayload, compareVersions, releasePlan, verifyBytes, selectBaseline} from './release-feed.mjs';

const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const rawKey = publicKey.export({format: 'der', type: 'spki'}).subarray(-32).toString('base64');
const pem = privateKey.export({format: 'pem', type: 'pkcs8'});
const entry = (version, type = 'Full', tag = `v${version}`) => ({
  asset: {PackageId: 'Mxplorer', Version: version, Type: type, FileName: `Mxplorer-${version}-${type.toLowerCase()}.nupkg`, SHA1: 'a'.repeat(40), SHA256: 'b'.repeat(64), Size: 42, NotesMarkdown: '', NotesHtml: ''},
  url: `https://github.com/morewebs/Mxplorer/releases/download/${tag}/Mxplorer-${version}-${type.toLowerCase()}.nupkg`,
});
const feed = (assets, channel = 'stable') => ({schema: 1, channel, publishedAt: '2026-11-13T12:00:00.000Z', assets});
const rawEnvelope = payload => {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {payload: bytes.toString('base64'), signature: sign(null, bytes, privateKey).toString('base64')};
};

test('signed envelope round-trips exact UTF8 bytes with the embedded raw public key', () => {
  const payload = feed([entry('0.3.0')]);
  assert.deepEqual(verifyEnvelope(makeEnvelope(payload, pem), rawKey, 'stable'), payload);
});
test('tampering fails before untrusted JSON is parsed', () => {
  const envelope = rawEnvelope(feed([entry('0.3.0')]));
  envelope.payload = Buffer.from('this is not JSON').toString('base64');
  assert.throws(() => verifyEnvelope(envelope, rawKey, 'stable'), /signature/i);
});
test('a valid signature cannot replace a different channel', () => {
  assert.throws(() => verifyEnvelope(rawEnvelope(feed([entry('0.3.0')], 'nightly')), rawKey, 'stable'), /channel/i);
});
test('unsafe filenames, digests, package identities and mutable/foreign URLs are rejected', () => {
  for (const mutate of [
    x => {x.asset.FileName = '../escape.nupkg';},
    x => {x.asset.SHA256 = '';},
    x => {x.asset.PackageId = 'Other';},
    x => {x.asset.Size = -1;},
    x => {x.asset.NotesMarkdown = null;},
    x => {x.asset.NotesHtml = null;},
    x => {x.url = x.url.replace('v0.3.0/', 'update-feed/');},
    x => {x.url = x.url.replace('github.com', 'evil.test');},
    x => {x.url += '?download=1';},
  ]) {
    const value = entry('0.3.0'); mutate(value);
    assert.throws(() => validatePayload(feed([value]), 'stable'));
  }
  assert.throws(() => validatePayload(feed([entry('0.3.0'), entry('0.3.0')]), 'stable'), /duplicate/i);
});
test('nightly ordering compares numeric run components rather than strings', () => {
  assert.equal(compareVersions('0.3.1-nightly.10.1', '0.3.1-nightly.9.9'), 1);
  assert.equal(compareVersions('0.3.1', '0.3.1-nightly.999.1'), 1);
});
test('bounded history keeps full fallbacks and only contiguous deltas', () => {
  const previous = feed([entry('0.3.0'), entry('0.3.1'), entry('0.3.1', 'Delta'), entry('0.3.2'), entry('0.3.2', 'Delta')]);
  const next = mergeFeed(previous, [entry('0.3.3'), entry('0.3.3', 'Delta')], {channel: 'stable', baselineVersion: '0.3.2', history: 3, publishedAt: '2026-11-14T00:00:00Z'});
  assert.deepEqual(next.assets.map(x => `${x.asset.Version}:${x.asset.Type}`), ['0.3.1:Full', '0.3.2:Full', '0.3.2:Delta', '0.3.3:Full', '0.3.3:Delta']);
});
test('out-of-order builds cannot roll the channel pointer backwards', () => {
  assert.equal(mergeFeed(feed([entry('0.3.2')]), [entry('0.3.1')], {channel: 'stable'}), null);
});
test('a delayed build uses the greatest authenticated full version below its target', () => {
  const previous = feed([entry('0.3.0'), entry('0.3.1'), entry('0.3.2'), entry('0.3.3')]);
  assert.equal(selectBaseline(previous, '0.3.2')?.asset.Version, '0.3.1');
  assert.equal(selectBaseline(previous, '0.3.0'), null);
  assert.equal(selectBaseline(null, '0.3.2'), null);
});
test('a delta built from an older baseline is dropped when an intermediate release won the race', () => {
  const next = mergeFeed(feed([entry('0.3.0'), entry('0.3.1')]), [entry('0.3.2'), entry('0.3.2', 'Delta')], {channel: 'stable', baselineVersion: '0.3.0'});
  assert.deepEqual(next.assets.filter(x => x.asset.Version === '0.3.2').map(x => x.asset.Type), ['Full']);
});
test('package downloads are authenticated by both size and SHA256', () => {
  const bytes = Buffer.from('hello');
  const asset = {Size: 5, SHA256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  assert.equal(verifyBytes(bytes, asset), true);
  assert.throws(() => verifyBytes(Buffer.from('hellO'), asset), /SHA256/);
  assert.throws(() => verifyBytes(Buffer.from('hell'), asset), /size/i);
});
test('main pushes derive next-patch nightlies while stable tags must match source', () => {
  assert.deepEqual(releasePlan({source: '0.3.0', ref: 'refs/heads/main', run: '10', attempt: '2'}), {channel: 'nightly', version: '0.3.1-nightly.10.2', tag: 'nightly-0.3.1-nightly.10.2'});
  assert.deepEqual(releasePlan({source: '0.3.0', ref: 'refs/tags/v0.3.0'}), {channel: 'stable', version: '0.3.0', tag: 'v0.3.0'});
  assert.throws(() => releasePlan({source: '0.3.0', ref: 'refs/tags/v0.2.0'}), /match/i);
  assert.throws(() => releasePlan({source: '0.3.0', ref: 'refs/tags/v0.3.0-beta.1'}));
});
