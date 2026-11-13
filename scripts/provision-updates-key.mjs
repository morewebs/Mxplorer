import {generateKeyPairSync,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';

// Private material only travels through child-process stdin/stdout, never arguments or logs.
if(process.platform!=='win32')throw new Error('Provisioning uses Windows DPAPI. Use the documented signing-key recovery procedure on other platforms.');
const backup=join(homedir(),'.mxplorer','update-signing-key.dpapi');
const publicFile=new URL('../src-tauri/update-public-key.txt',import.meta.url);
mkdirSync(dirname(backup),{recursive:true});
function dpapi(operation,input){
  const action=operation==='protect'
    ? '$bytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); $encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [IO.File]::WriteAllBytes($env:MXPLORER_KEY_BACKUP,$encrypted); [Array]::Clear($bytes,0,$bytes.Length)'
    : '$bytes=[IO.File]::ReadAllBytes($env:MXPLORER_KEY_BACKUP); $plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain)); [Array]::Clear($plain,0,$plain.Length)';
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; ${action}`],{input,encoding:'utf8',env:{...process.env,MXPLORER_KEY_BACKUP:backup},windowsHide:true});
  if(result.status!==0)throw new Error(`DPAPI ${operation} failed. Private key was not displayed.`);
  return result.stdout;
}
let pem;
if(existsSync(backup))pem=dpapi('unprotect');
else{
  pem=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
  dpapi('protect',pem);
}
const privateKey=createPrivateKey(pem);
const publicKey=createPublicKey(privateKey);
const rawPublic=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64');
if(existsSync(publicFile)&&readFileSync(publicFile,'utf8').trim()!==rawPublic)throw new Error('Existing public key differs from this DPAPI backup. Refusing an accidental signing-key rotation.');
const probe=Buffer.from('Mxplorer updater key validation');
if(!verify(null,probe,publicKey,sign(null,probe,privateKey)))throw new Error('Signing key self-check failed.');
writeFileSync(publicFile,`${rawPublic}\n`);
const uploaded=spawnSync('gh',['secret','set','MXPLORER_UPDATE_SIGNING_KEY','--repo','morewebs/Mxplorer'],{input:pem,encoding:'utf8',windowsHide:true});
pem='';
if(uploaded.status!==0)throw new Error('GitHub secret upload failed; encrypted local backup and matching public key were preserved for retry.');
console.log(`Updater signing secret configured. Encrypted backup: ${backup}`);
console.log('Committed public key path: src-tauri/update-public-key.txt');
