import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Conservative CI guard for literal backend SQL. It does not cover dynamic SQL
// or direct D1 queries executed outside the Worker; use EXPLAIN for those.
const root = fileURLToPath(new URL('../src/', import.meta.url));
const historyReference = /\b(?:FROM|JOIN|UPDATE|DELETE\s+FROM)\s+metrics_history(?:_old)?\b/gi;
const indexedPredicate = /\bWHERE\s+(?:[a-zA-Z_][\w]*\.)?(?:id|server_id)\b/i;
const violations = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'frontend') walk(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(historyReference)) {
      const sqlFragment = source.slice(match.index, match.index + 220);
      if (indexedPredicate.test(sqlFragment)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(relative(root, path) + ':' + line + ': history SQL lacks an indexed id/server_id predicate');
    }
  }
}

walk(root);
if (violations.length > 0) {
  console.error('Unsafe history SQL detected. Use indexed predicates and review EXPLAIN QUERY PLAN:');
  for (const violation of violations) console.error('  ' + violation);
  process.exitCode = 1;
} else {
  console.log('D1 history SQL guard: OK (literal backend queries use indexed predicates)');
}
