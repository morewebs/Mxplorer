import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {REPOSITORY, FEED_ROOT} from './release-feed.mjs';

const API_ROOT = `https://api.github.com/repos/${REPOSITORY}/pages/deployments`;
const MAX_TIMEOUT_MS = 9 * 60_000;
const FAILED = new Set(['deployment_failed', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost']);
const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function maskDefault(value) { console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`); }

// A small REST client is necessary because deploy-pages v5.0.1 fixes build identity to
// GITHUB_SHA, deduplicating different feed artifacts from a stable tag and main run.
// GitHub's documented pages_build_version accepts a unique build string; we use the
// exact orphan-branch revision that supplied both staged channel files.
export async function deployPages({artifactId, revision, githubToken, oidcUrl, oidcRequestToken,
  fetchImpl = fetch, mask = maskDefault, logger = console.log, now = Date.now,
  sleep = sleepDefault, timeoutMs = MAX_TIMEOUT_MS, pollMs = 5_000}) {
  requireCondition(/^[1-9]\d*$/.test(String(artifactId)) && Number.isSafeInteger(Number(artifactId)), 'Invalid Pages artifact id');
  requireCondition(/^[a-f0-9]{40}$/.test(revision ?? ''), 'Invalid canonical metadata revision');
  requireCondition(typeof githubToken === 'string' && githubToken.length > 0, 'Pages deployment requires GH_TOKEN');
  requireCondition(typeof oidcRequestToken === 'string' && oidcRequestToken.length > 0, 'Pages OIDC requires id-token: write');
  let identityUrl;
  try { identityUrl = new URL(oidcUrl); } catch { throw new Error('Invalid Actions OIDC request URL'); }
  requireCondition(identityUrl.protocol === 'https:' && identityUrl.hostname.endsWith('.actions.githubusercontent.com') && !identityUrl.username && !identityUrl.password && !identityUrl.port, 'Invalid Actions OIDC request URL');
  requireCondition(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS, 'Pages timeout must be at most nine minutes');
  requireCondition(Number.isFinite(pollMs) && pollMs >= 1_000 && pollMs <= 30_000, 'Invalid Pages polling interval');
  const deadline = now() + timeoutMs;
  const headers = {Accept: 'application/vnd.github+json', Authorization: `Bearer ${githubToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Mxplorer-release'};
  async function request(url, method, requestHeaders, body, phase, allowance) {
    const remaining = allowance ?? deadline - now();
    requireCondition(remaining > 0, 'Pages deployment timed out');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(30_000, remaining));
    try {
      let result;
      try { result = await fetchImpl(url, {method, redirect: 'error', headers: requestHeaders, ...(body ? {body: JSON.stringify(body)} : {}), signal: controller.signal}); }
      catch { throw new Error(`${phase} request failed or timed out`); }
      // Do not include response bodies or underlying request errors: they may contain credentials.
      requireCondition(result.ok, `${phase} failed: HTTP ${result.status}`);
      if (result.status === 204) return null;
      let text;
      try { text = await result.text(); } catch { throw new Error(`${phase} response failed or timed out`); }
      requireCondition(Buffer.byteLength(text) <= 65_536, `${phase} response exceeds size bound`);
      try { return JSON.parse(text); } catch { throw new Error(`${phase} returned invalid JSON`); }
    } finally { clearTimeout(timer); }
  }
  const identity = await request(identityUrl.href, 'GET', {Authorization: `Bearer ${oidcRequestToken}`}, null, 'OIDC authentication');
  const idToken = identity?.value;
  requireCondition(typeof idToken === 'string' && idToken.length > 0 && idToken.length <= 32_768 && !/[\r\n]/.test(idToken), 'OIDC authentication returned no valid token');
  mask(idToken);
  const deployment = await request(API_ROOT, 'POST', {...headers, 'Content-Type': 'application/json'}, {artifact_id: Number(artifactId), pages_build_version: revision, oidc_token: idToken, environment: 'github-pages'}, 'Pages deployment');
  const id = String(deployment?.id ?? '');
  requireCondition(/^[A-Za-z0-9_-]{1,128}$/.test(id), 'Pages deployment returned an invalid id');
  requireCondition(deployment.page_url === FEED_ROOT || deployment.page_url === FEED_ROOT.slice(0, -1), 'Pages deployment returned an unexpected site URL');
  const endpoint = `${API_ROOT}/${encodeURIComponent(id)}`;
  logger(`Created Pages deployment ${id} for canonical metadata ${revision}.`);
  try {
    while (now() < deadline) {
      await sleep(Math.min(pollMs, deadline - now()));
      requireCondition(now() < deadline, 'Pages deployment timed out');
      const state = await request(endpoint, 'GET', headers, null, 'Pages deployment status');
      requireCondition(typeof state?.status === 'string' && state.status.length <= 80, 'Pages deployment returned an invalid status');
      if (state.status === 'succeed') {
        logger(`Pages deployment ${id} succeeded for canonical metadata ${revision}.`);
        return {pageUrl: FEED_ROOT, revision, deploymentId: id};
      }
      requireCondition(!FAILED.has(state.status), `Pages deployment failed: ${state.status}`);
    }
    throw new Error('Pages deployment timed out');
  } catch (error) {
    try { await request(`${endpoint}/cancel`, 'POST', headers, null, 'Pages deployment cancellation', 5_000); }
    catch { logger('Could not confirm Pages deployment cancellation; deployment remains failed locally.'); }
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await deployPages({artifactId: process.env.PAGES_ARTIFACT_ID, revision: process.env.PAGES_METADATA_REVISION, githubToken: process.env.GH_TOKEN, oidcUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL, oidcRequestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN});
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `page_url=${result.pageUrl}\nrevision=${result.revision}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
