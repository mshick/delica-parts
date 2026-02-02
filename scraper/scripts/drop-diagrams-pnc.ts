import { getClient, closeClient } from "../src/db/client.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

const client = getClient(DEFAULT_CONFIG.dbPath);

await client.execute('DROP INDEX IF EXISTS idx_diagrams_pnc');
await client.execute('ALTER TABLE diagrams DROP COLUMN pnc');
console.log('pnc column dropped from diagrams');

await closeClient();
