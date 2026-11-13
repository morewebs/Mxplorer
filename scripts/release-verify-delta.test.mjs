import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {comparePackages} from './release-verify-delta.mjs';

test('round-trip verification compares uncompressed package contents rather than compressed bytes', {skip: process.platform !== 'win32'}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mxplorer-delta-test-'));
  const fixture = join(root, 'fixture.ps1');
  await writeFile(fixture, `Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($variant in @('expected','same','changed')) {
  $archive = [System.IO.Compression.ZipFile]::Open((Join-Path $PSScriptRoot "$variant.nupkg"), 'Create')
  $entry = $archive.CreateEntry('lib/app.txt')
  $writer = [System.IO.StreamWriter]::new($entry.Open())
  $writer.Write($(if ($variant -eq 'changed') {'tampered'} else {'original'}))
  $writer.Dispose()
  $entry = $archive.CreateEntry('Mxplorer.nuspec')
  $writer = [System.IO.StreamWriter]::new($entry.Open())
  $writer.Write('<package><metadata><version>0.3.0</version></metadata></package>')
  $writer.Dispose()
  $archive.Dispose()
}`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fixture]);
  assert.equal(await comparePackages(join(root, 'expected.nupkg'), join(root, 'same.nupkg'), '0.3.0'), true);
  await assert.rejects(comparePackages(join(root, 'expected.nupkg'), join(root, 'changed.nupkg'), '0.3.0'), /content|differs/i);
  await assert.rejects(comparePackages(join(root, 'expected.nupkg'), join(root, 'same.nupkg'), '0.2.0'), /version/i);
});
