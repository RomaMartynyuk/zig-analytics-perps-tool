import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSql } from '../server/db.js';

const migrationsDirectory = new URL('../migrations/', import.meta.url);
const sql = getSql();

await sql.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const files = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith('.sql'))
  .sort();

for (const filename of files) {
  const applied = await sql`SELECT filename FROM schema_migrations WHERE filename = ${filename}`;
  if (applied.length) continue;

  const source = await readFile(join(migrationsDirectory.pathname, filename), 'utf8');
  const statements = source.split('\n-- migrate:split\n').map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) await sql.query(statement);
  await sql`INSERT INTO schema_migrations (filename) VALUES (${filename})`;
  console.log(`Applied ${filename}`);
}
