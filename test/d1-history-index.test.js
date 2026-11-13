import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { initDatabase, weeklyCleanup } from '../src/database/schema.js';
import { HISTORY_SERVER_TIMESTAMP_INDEX_NAMES } from '../src/database/historyIndexes.js';

const INDEX_SQL = "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?) ORDER BY name";

async function getHistoryIndexes(db) {
  const { results } = await db.prepare(INDEX_SQL)
    .bind(...HISTORY_SERVER_TIMESTAMP_INDEX_NAMES).all();
  return results;
}

test('indexed server/time diagnostics survive weekly history rotations', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("OK"); } }',
    d1Databases: { DB: 'd1-history-index-test' }
  });

  try {
    const db = await mf.getD1Database('DB');
    await initDatabase(db);
    const firstIndexes = await getHistoryIndexes(db);
    assert.equal(firstIndexes.length, 1);
    assert.equal(firstIndexes[0].tbl_name, 'metrics_history');

    await db.prepare("INSERT INTO servers (id, name, history_partition_id) VALUES ('a', 'A', 1), ('b', 'B', 2)").run();
    for (let start = 0; start < 1000; start += 100) {
      const rows = Array.from({ length: 100 }, (_, offset) => {
        const id = start + offset + 1;
        const server = id % 2 ? 'a' : 'b';
        return '(' + id + ", '" + server + "', " + (id * 1000) + ", '203.0.113.1')";
      });
      await db.prepare('INSERT INTO metrics_history (id, server_id, timestamp, ip_v4) VALUES ' + rows.join(', ')).run();
    }

    const sql = 'SELECT s.id, (SELECT h.ip_v4 FROM metrics_history h WHERE h.server_id = s.id ORDER BY h.timestamp DESC LIMIT 1) AS latest_ip FROM servers s';
    const plan = await db.prepare('EXPLAIN QUERY PLAN ' + sql).all();
    const details = plan.results.map(row => String(row.detail));
    assert.ok(details.some(detail => /SEARCH h USING INDEX idx_metrics_history_server_ts_[ab]/.test(detail)));
    assert.ok(details.every(detail => !/SCAN h\b/.test(detail)));

    const lookup = await db.prepare(sql).all();
    assert.equal(lookup.results.length, 2);
    assert.ok(lookup.meta.rows_read < 100, 'indexed lookup read ' + lookup.meta.rows_read + ' rows');

    const firstRotation = await weeklyCleanup(db);
    assert.equal(firstRotation.success, true);
    const afterFirst = await getHistoryIndexes(db);
    assert.equal(afterFirst.length, 2);
    assert.equal(afterFirst.filter(item => item.tbl_name === 'metrics_history').length, 1);
    assert.equal(afterFirst.filter(item => item.tbl_name === 'metrics_history_old').length, 1);
    const retained = await db.prepare('SELECT COUNT(*) AS total FROM metrics_history_old').first();
    assert.equal(retained.total, 1000);

    const secondRotation = await weeklyCleanup(db);
    assert.equal(secondRotation.success, true);
    const afterSecond = await getHistoryIndexes(db);
    assert.equal(afterSecond.length, 2);
    assert.equal(afterSecond.filter(item => item.tbl_name === 'metrics_history').length, 1);
    assert.equal(afterSecond.filter(item => item.tbl_name === 'metrics_history_old').length, 1);
    assert.equal(afterSecond.find(item => item.tbl_name === 'metrics_history').name, firstIndexes[0].name);
  } finally {
    await mf.dispose();
  }
});
