import {execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export async function comparePackages(expected, actual, version) {
  const script = fileURLToPath(new URL('./release-compare-packages.ps1', import.meta.url));
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Expected', expected, '-Actual', actual, '-Version', version], {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  return true;
}
export async function verifyDelta(output, metadata, channel, version, vpk = 'vpk') {
  const {baselineFile} = JSON.parse(await readFile(metadata, 'utf8'));
  if (!baselineFile) { console.log('First release: no baseline, full package only.'); return; }
  const feed = JSON.parse(await readFile(join(output, `releases.${channel}.json`), 'utf8'));
  const full = feed.Assets.find(x => x.Version === version && x.Type === 'Full');
  const delta = feed.Assets.find(x => x.Version === version && x.Type === 'Delta');
  if (!full || !delta) throw new Error('Baseline exists but vpk did not generate both full and delta packages');
  const verification = join(output, 'verification');
  await mkdir(verification, {recursive: true});
  const reconstructed = join(verification, 'reconstructed.nupkg');
  execFileSync(vpk, ['delta', 'patch', '--base', join(output, baselineFile), '--patch', join(output, delta.FileName), '--output', reconstructed], {stdio: 'inherit', windowsHide: true});
  await comparePackages(join(output, full.FileName), reconstructed, version);
  const evidence = {version, baselineFile, fullBytes: (await stat(join(output, full.FileName))).size, deltaBytes: (await stat(join(output, delta.FileName))).size, packageContentsMatch: true};
  evidence.savesBytes = evidence.deltaBytes < evidence.fullBytes;
  await writeFile(join(verification, 'delta-verification.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyDelta(...process.argv.slice(2));
