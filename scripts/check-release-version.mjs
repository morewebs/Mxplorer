import {readFileSync} from 'node:fs';
const tag=process.argv[2];
const match=/^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag||'');
if(!match)throw new Error('Release tags must use vMAJOR.MINOR.PATCH, optionally with a prerelease suffix.');
const version=match[1];
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const cargoPackage=/^\[package\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(read('src-tauri/Cargo.toml'))?.[1];
const versions={
  'package.json':JSON.parse(read('package.json')).version,
  'package-lock.json':JSON.parse(read('package-lock.json')).version,
  'src-tauri/tauri.conf.json':JSON.parse(read('src-tauri/tauri.conf.json')).version,
  'src-tauri/Cargo.toml':/^version\s*=\s*"([^"]+)"/m.exec(cargoPackage||'')?.[1],
};
for(const [file,actual] of Object.entries(versions))if(actual!==version)throw new Error(`${file} is ${actual}, but the release tag is ${tag}. Update all package versions before tagging.`);
console.log(`Release ${tag}: all package versions agree.`);
