import { getClient, closeClient } from "../src/db/client.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

// Remove numeric suffix from diagram ID
// e.g., "engine-engine-assy-148" -> "engine-engine-assy"
// e.g., "automatic-transmission-a-t-brake-67980_67981" -> "automatic-transmission-a-t-brake"
function cleanId(id: string): string {
  return id.replace(/-[\d_]+$/, "");
}

async function main() {
  const client = getClient(DEFAULT_CONFIG.dbPath);

  // Disable foreign key checks
  await client.execute("PRAGMA foreign_keys = OFF");

  // Get all diagram IDs
  const result = await client.execute("SELECT id FROM diagrams");

  console.log(`Found ${result.rows.length} diagrams`);

  let updated = 0;
  for (const row of result.rows) {
    const oldId = row.id as string;
    const newId = cleanId(oldId);

    if (oldId !== newId) {
      // Update parts to reference new ID
      await client.execute({
        sql: "UPDATE parts SET diagram_id = ? WHERE diagram_id = ?",
        args: [newId, oldId],
      });

      // Update diagram ID
      await client.execute({
        sql: "UPDATE diagrams SET id = ? WHERE id = ?",
        args: [newId, oldId],
      });

      updated++;
    }
  }

  console.log(`Updated ${updated} diagram IDs`);

  // Re-enable foreign key checks
  await client.execute("PRAGMA foreign_keys = ON");

  // Verify
  const check = await client.execute("SELECT id FROM diagrams LIMIT 5");
  console.log("Sample IDs after update:");
  for (const row of check.rows) {
    console.log(`  ${row.id}`);
  }

  await closeClient();
}

main();
