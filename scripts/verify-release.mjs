import fs from 'node:fs';
import assert from 'node:assert/strict';
const lock=JSON.parse(fs.readFileSync('RELEASE_LOCK.json','utf8'));
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
assert.equal(pkg.version,'2.8.7');
assert.equal(lock.ip_quality_diagnostics,false);
assert.equal(lock.route_tracing,false);
assert.equal(lock.nodequality,false);
const wrangler=fs.readFileSync('wrangler.toml','utf8');
assert.match(wrangler,/main = "src\/index\.js"/);
assert.ok(wrangler.includes('064088a9-cc83-42b8-973e-8494bcaf0b71'));
assert.ok(!wrangler.includes('src/network-entry.js'));
for(const arch of ['amd64','arm64'])
  assert.ok(fs.statSync('public/agent/cf-probe-linux-'+arch).size>1000000);
assert.ok(!fs.existsSync('public/netdiag'));
assert.ok(!fs.existsSync('src/netdiag'));
assert.ok(!fs.existsSync('src/network-entry.js'));
assert.ok(!/^\s+schedule:/m.test(fs.readFileSync('.github/workflows/sync.yml','utf8')));
console.log('Monitor-only rollback verified; non-root ICMP agent and offline upstream sync preserved.');
