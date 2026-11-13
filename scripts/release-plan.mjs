import {readFile, appendFile} from 'node:fs/promises';
import {releasePlan} from './release-feed.mjs';

const source = JSON.parse(await readFile('package.json', 'utf8')).version;
const plan = releasePlan({source, ref: process.env.GITHUB_REF, run: process.env.GITHUB_RUN_NUMBER, attempt: process.env.GITHUB_RUN_ATTEMPT});
if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
await appendFile(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''));
console.log(`Building ${plan.channel} ${plan.version}`);
