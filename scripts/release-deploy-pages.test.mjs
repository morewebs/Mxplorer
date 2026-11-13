import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deployPages} from './release-deploy-pages.mjs';

const firstRevision = '1'.repeat(40), secondRevision = '2'.repeat(40);
const oidc = 'oidc.secret.token', githubToken = 'github-secret-token';
const oidcUrl = 'https://vstoken.actions.githubusercontent.com/id-token?api-version=2.0';
const pageUrl = 'https://morewebs.github.io/Mxplorer/';
const response = (value, status = 200) => new Response(JSON.stringify(value), {status});
const options = extra => ({artifactId: '101', revision: firstRevision, githubToken, oidcUrl, oidcRequestToken: 'oidc-request-secret', mask: () => {}, logger: () => {}, sleep: async () => {}, ...extra});

test('distinct metadata revisions deploy both channel snapshots from the same application commit', async t => {
  const original = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = 'a'.repeat(40);
  t.after(() => { if (original === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = original; });
  const artifacts = new Map([[101, ['stable.json']], [102, ['stable.json', 'nightly.json']]]);
  const builds = new Map(); let site = [];
  const fetchImpl = async (url, request) => {
    if (url === oidcUrl) return response({value: oidc});
    if (request.method === 'POST' && url.endsWith('/pages/deployments')) {
      const payload = JSON.parse(request.body);
      // Reproduce the hosted backend: the first artifact for a build version wins.
      if (!builds.has(payload.pages_build_version)) builds.set(payload.pages_build_version, artifacts.get(payload.artifact_id));
      site = builds.get(payload.pages_build_version);
      return response({id: payload.pages_build_version, page_url: pageUrl});
    }
    return response({status: 'succeed'});
  };
  await deployPages(options({fetchImpl}));
  assert.deepEqual(site, ['stable.json']);
  const result = await deployPages(options({artifactId: '102', revision: secondRevision, fetchImpl}));
  assert.deepEqual(site, ['stable.json', 'nightly.json']);
  assert.equal(result.pageUrl, pageUrl);
  assert.equal(result.revision, secondRevision);
});
test('OIDC authentication failure aborts without submitting a deployment or leaking tokens', async () => {
  const logs = [];
  await assert.rejects(deployPages(options({logger: value => logs.push(value), fetchImpl: async () => response({message: oidc}, 401)})), /OIDC.*HTTP 401/);
  assert.ok(logs.every(value => !value.includes(oidc) && !value.includes(githubToken)));
});
test('Pages HTTP errors report status without echoing credential-bearing response bodies', async () => {
  const fetchImpl = async url => url === oidcUrl ? response({value: oidc}) : response({message: `${oidc} ${githubToken}`}, 403);
  await assert.rejects(deployPages(options({fetchImpl})), error => /Pages deployment.*HTTP 403/.test(error.message) && !error.message.includes(oidc) && !error.message.includes(githubToken));
});
test('polling is bounded and a timed out deployment is cancelled before returning failure', async () => {
  let now = 0, cancelled = false;
  const fetchImpl = async (url, request) => {
    if (url === oidcUrl) return response({value: oidc});
    if (url.endsWith('/cancel')) {cancelled = true; return new Response(null, {status: 204});}
    if (request.method === 'POST') return response({id: firstRevision, page_url: pageUrl});
    return response({status: 'deployment_in_progress'});
  };
  await assert.rejects(deployPages(options({fetchImpl, timeoutMs: 15_000, now: () => now, sleep: async ms => {now += ms;}})), /timed out/);
  assert.equal(cancelled, true);
  assert.ok(now <= 15_000);
});
test('terminal deployment failures fail closed instead of reporting a successful mirror', async () => {
  const fetchImpl = async (url, request) => {
    if (url === oidcUrl) return response({value: oidc});
    if (url.endsWith('/cancel')) return new Response(null, {status: 204});
    if (request.method === 'POST') return response({id: firstRevision, page_url: pageUrl});
    return response({status: 'deployment_content_failed'});
  };
  await assert.rejects(deployPages(options({fetchImpl})), /deployment_content_failed/);
});
