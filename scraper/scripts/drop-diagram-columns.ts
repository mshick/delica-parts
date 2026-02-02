import { getClient, closeClient } from "../src/db/client.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

const client = getClient(DEFAULT_CONFIG.dbPath);

// Check which columns exist
const result = await client.execute('PRAGMA table_info(diagrams)');
const columns = new Set(result.rows.map(r => r.name as string));

if (columns.has('diagram_group')) {
  await client.execute('DROP INDEX IF EXISTS idx_diagrams_diagram_group');
  await client.execute('ALTER TABLE diagrams DROP COLUMN diagram_group');
  console.log('diagram_group column dropped');
}

if (columns.has('detail_page_id')) {
  await client.execute('DROP INDEX IF EXISTS idx_diagrams_detail_page_id');
  await client.execute('ALTER TABLE diagrams DROP COLUMN detail_page_id');
  console.log('detail_page_id column dropped');
}

console.log('Done');
await closeClient();
