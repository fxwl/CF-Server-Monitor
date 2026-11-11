import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const base='public/netdiag/nq/';
const digest=path=>crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const path=base+'manifest.json';
const manifest=JSON.parse(fs.readFileSync(path,'utf8'));
assert.equal(manifest.version,'1.0.0');
assert.equal(manifest.auto_update,false);
assert.equal(manifest.external_upload,false);
assert.equal(manifest.schedule,'Fri *-*-* 21:00:00 Asia/Shanghai');
assert.equal(manifest.upstream_commit,'a92fca6c0067df29ddd03fdc2fee6f3000f64545');
for(const file of Object.keys(manifest.files)){
 assert.ok(/^(NodeQuality\.sh|runner\.py|vendor\/(ip|net|hardware)\.sh)$/.test(file));
 manifest.files[file]=digest(base+file);
}
manifest.install_sha256=digest(base+'install.sh');
fs.writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
console.log('Weekly NQ pinned source files and installer SHA256 sealed.');
