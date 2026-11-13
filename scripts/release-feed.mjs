import {createHash, createPublicKey, createPrivateKey, sign, verify} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const REPOSITORY = 'morewebs/Mxplorer';
export const RELEASE_ROOT = `https://github.com/${REPOSITORY}/releases/download/`;
export const FEED_ROOT = 'https://morewebs.github.io/Mxplorer/';
export const MAX_FEED_BYTES = 1024 * 1024;
export const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
function parseVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(nightly)\.(0|[1-9]\d*)\.(0|[1-9]\d*))?$/.exec(value);
  requireCondition(match, `Unsupported version: ${value}`);
  return {core: match.slice(1, 4).map(BigInt), nightly: match[4] ? match.slice(5, 7).map(BigInt) : null};
}
export function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  const compare = (x, y) => x > y ? 1 : x < y ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    const result = compare(left.core[i], right.core[i]);
    if (result) return result;
  }
  if (!left.nightly || !right.nightly) return compare(Number(!left.nightly), Number(!right.nightly));
  return compare(left.nightly[0], right.nightly[0]) || compare(left.nightly[1], right.nightly[1]);
}
export function releasePlan({source, ref, run, attempt}) {
  const parsed = parseVersion(source);
  requireCondition(!parsed.nightly, 'Source must have a stable version');
  if (ref === 'refs/heads/main') {
    requireCondition(/^[1-9]\d*$/.test(run) && /^[1-9]\d*$/.test(attempt), 'Invalid run or attempt');
    const version = `${parsed.core[0]}.${parsed.core[1]}.${parsed.core[2] + 1n}-nightly.${run}.${attempt}`;
    return {channel: 'nightly', version, tag: `nightly-${version}`};
  }
  requireCondition(ref === `refs/tags/v${source}`, 'Stable tag must match the source version');
  return {channel: 'stable', version: source, tag: `v${source}`};
}
export function validatePayload(payload, channel) {
  requireCondition(['stable', 'nightly'].includes(channel) && payload?.channel === channel, 'Feed channel mismatch');
  requireCondition(payload.schema === 1 && typeof payload.publishedAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(payload.publishedAt) && Number.isFinite(Date.parse(payload.publishedAt)), 'Invalid feed schema or date');
  requireCondition(Array.isArray(payload.assets) && payload.assets.length > 0 && payload.assets.length <= 64, 'Invalid asset count');
  const filenames = new Set();
  for (const entry of payload.assets) {
    const asset = entry?.asset;
    requireCondition(asset?.PackageId === 'Mxplorer', 'Invalid package identity');
    const version = parseVersion(asset.Version);
    requireCondition(Boolean(version.nightly) === (channel === 'nightly'), 'Asset version channel mismatch');
    requireCondition(['Full', 'Delta'].includes(asset.Type), 'Invalid asset type');
    requireCondition(typeof asset.FileName === 'string' && /^Mxplorer-[A-Za-z0-9_.-]+\.nupkg$/.test(asset.FileName) && !asset.FileName.includes('..'), 'Unsafe package filename');
    requireCondition(!filenames.has(asset.FileName), 'Duplicate package filename');
    filenames.add(asset.FileName);
    requireCondition(typeof asset.SHA256 === 'string' && /^[a-fA-F0-9]{64}$/.test(asset.SHA256), 'Invalid SHA256');
    requireCondition(typeof asset.SHA1 === 'string' && /^[a-fA-F0-9]{40}$/.test(asset.SHA1), 'Invalid SHA1');
    requireCondition(Number.isSafeInteger(asset.Size) && asset.Size > 0 && asset.Size <= MAX_PACKAGE_BYTES, 'Invalid package size');
    requireCondition(typeof asset.NotesMarkdown === 'string' && typeof asset.NotesHtml === 'string', 'Invalid release notes');
    const tag = channel === 'stable' ? `v${asset.Version}` : `nightly-${asset.Version}`;
    requireCondition(entry.url === `${RELEASE_ROOT}${tag}/${encodeURIComponent(asset.FileName)}`, 'Invalid immutable asset URL');
  }
  return payload;
}
function decodeBase64(value, label) {
  requireCondition(typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), `Invalid ${label} encoding`);
  return Buffer.from(value, 'base64');
}
export function makeEnvelope(payload, pem) {
  validatePayload(payload, payload.channel);
  const bytes = Buffer.from(JSON.stringify(payload));
  requireCondition(bytes.length <= MAX_FEED_BYTES / 2, 'Feed too large');
  const key = createPrivateKey(pem);
  requireCondition(key.asymmetricKeyType === 'ed25519', 'Signing key must be Ed25519');
  return {payload: bytes.toString('base64'), signature: sign(null, bytes, key).toString('base64')};
}
export function verifyEnvelope(envelope, rawKey, channel) {
  requireCondition(Buffer.byteLength(JSON.stringify(envelope)) <= MAX_FEED_BYTES, 'Feed too large');
  const bytes = decodeBase64(envelope?.payload, 'payload');
  const signature = decodeBase64(envelope?.signature, 'signature');
  const keyBytes = decodeBase64(rawKey.trim(), 'public key');
  requireCondition(keyBytes.length === 32 && signature.length === 64, 'Invalid signature or public key length');
  const key = createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), keyBytes]), format: 'der', type: 'spki'});
  requireCondition(verify(null, bytes, key, signature), 'Invalid feed signature');
  return validatePayload(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), channel);
}
export function verifyBytes(bytes, asset) {
  requireCondition(bytes.length === asset.Size, 'Package size mismatch');
  requireCondition(createHash('sha256').update(bytes).digest('hex') === asset.SHA256.toLowerCase(), 'Package SHA256 mismatch');
  return true;
}
export function latestFull(payload) {
  return payload?.assets.filter(x => x.asset.Type === 'Full').sort((a, b) => compareVersions(b.asset.Version, a.asset.Version))[0] ?? null;
}
export function selectBaseline(payload, targetVersion) {
  compareVersions(targetVersion, targetVersion);
  return latestFull({assets: (payload?.assets ?? []).filter(x => compareVersions(x.asset.Version, targetVersion) < 0)});
}
export function mergeFeed(previous, assets, {channel, baselineVersion = null, history = 12, publishedAt = new Date().toISOString()}) {
  if (previous) validatePayload(previous, channel);
  validatePayload({schema: 1, channel, publishedAt, assets}, channel);
  const current = latestFull(previous), next = latestFull({assets});
  requireCondition(next && assets.every(x => x.asset.Version === next.asset.Version), 'New assets must contain one version and a full fallback');
  if (current && compareVersions(next.asset.Version, current.asset.Version) <= 0) return null;
  const additions = assets.filter(x => x.asset.Type === 'Full' || (current && baselineVersion === current.asset.Version));
  const all = [...(previous?.assets ?? []), ...additions];
  const versions = [...new Set(all.filter(x => x.asset.Type === 'Full').map(x => x.asset.Version))].sort(compareVersions).slice(-history);
  const retained = all.filter(x => versions.includes(x.asset.Version) && (x.asset.Type === 'Full' || x.asset.Version !== versions[0]));
  retained.sort((a, b) => compareVersions(a.asset.Version, b.asset.Version) || (a.asset.Type === 'Full' ? -1 : 1));
  return validatePayload({schema: 1, channel, publishedAt, assets: retained}, channel);
}

// GitHub asset redirects terminate at its dedicated object storage; do not follow arbitrary hosts.
export async function fetchBounded(url, limit, {missing = false, headers = {}} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    for (let redirect = 0; redirect <= 5; redirect++) {
      const parsed = new URL(url);
      requireCondition(parsed.protocol === 'https:' && ['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname), 'Unsafe download redirect');
      const response = await fetch(url, {redirect: 'manual', signal: controller.signal, headers: {'User-Agent': 'Mxplorer-release', ...(parsed.hostname === 'api.github.com' ? headers : {})}});
      if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get('location'), url).href; continue; }
      if (missing && response.status === 404) return null;
      requireCondition(response.ok, `Download failed: HTTP ${response.status}`);
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        requireCondition(length <= limit, 'Download exceeds size bound');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }
    throw new Error('Too many download redirects');
  } finally { clearTimeout(timeout); }
}
export async function fetchChannel(channel, publicKey) {
  requireCondition(['stable', 'nightly'].includes(channel), 'Invalid channel');
  const token = process.env.GH_TOKEN;
  const bytes = await fetchBounded(`https://api.github.com/repos/${REPOSITORY}/contents/${channel}.json?ref=update-feed`, MAX_FEED_BYTES * 2, {missing: true, headers: {Accept: 'application/vnd.github+json', ...(token ? {Authorization: `Bearer ${token}`} : {})}});
  if (!bytes) return null;
  const file = JSON.parse(bytes.toString('utf8'));
  requireCondition(file.encoding === 'base64' && typeof file.content === 'string', 'Invalid GitHub feed content');
  const envelope = Buffer.from(file.content, 'base64');
  requireCondition(envelope.length <= MAX_FEED_BYTES, 'Feed too large');
  return verifyEnvelope(JSON.parse(envelope.toString('utf8')), publicKey, channel);
}
export async function restoreBaseline(channel, targetVersion, output, metadata, publicKey) {
  const previous = await fetchChannel(channel, publicKey);
  const baseline = selectBaseline(previous, targetVersion);
  await mkdir(output, {recursive: true});
  if (baseline) {
    const bytes = await fetchBounded(baseline.url, baseline.asset.Size);
    verifyBytes(bytes, baseline.asset);
    await writeFile(join(output, baseline.asset.FileName), bytes);
  }
  await writeFile(metadata, JSON.stringify({baselineVersion: baseline?.asset.Version ?? null, baselineFile: baseline?.asset.FileName ?? null}));
  return baseline;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, channel, targetVersion, output, metadata] = process.argv.slice(2);
  requireCondition(command === 'restore' && targetVersion && output && metadata, 'Usage: node scripts/release-feed.mjs restore CHANNEL TARGET_VERSION OUTPUT METADATA');
  await restoreBaseline(channel, targetVersion, output, metadata, await readFile('src-tauri/update-public-key.txt', 'utf8'));
}
