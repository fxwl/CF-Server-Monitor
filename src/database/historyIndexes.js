// Two index-name slots are used because SQLite keeps index names when a table
// is renamed. Weekly rotation keeps both current and previous history indexed
// without rebuilding the previous week's index or multiplying index writes.
export const HISTORY_SERVER_TIMESTAMP_INDEX_NAMES = Object.freeze([
  'idx_metrics_history_server_ts_a',
  'idx_metrics_history_server_ts_b'
]);

export async function ensureHistoryServerTimestampIndex(db) {
  const { results = [] } = await db.prepare(
    "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?)"
  ).bind(...HISTORY_SERVER_TIMESTAMP_INDEX_NAMES).all();

  const current = results.find(row => row.tbl_name === 'metrics_history');
  if (current) return current.name;

  const usedNames = new Set(results.map(row => row.name));
  const availableName = HISTORY_SERVER_TIMESTAMP_INDEX_NAMES.find(name => !usedNames.has(name));
  if (!availableName) {
    throw new Error('No free history index slot; check metrics_history table rotation');
  }

  await db.prepare(
    'CREATE INDEX IF NOT EXISTS ' + availableName +
    ' ON metrics_history (server_id, timestamp DESC)'
  ).run();
  return availableName;
}
