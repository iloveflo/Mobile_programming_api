import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function scan(dir) {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await scan(path);
    else if (path.endsWith('.js')) { const p = spawnSync(process.execPath,['--check',path],{stdio:'inherit'}); if(p.status) process.exitCode=1; }
  }
}
for (const dir of ['src','scripts','test']) await scan(dir);
