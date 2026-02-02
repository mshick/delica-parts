/**
 * Clean redundant text from existing subgroup and diagram names.
 *
 * Run with: deno run --allow-read --allow-write --allow-env --allow-ffi scripts/clean-subgroup-names.ts
 */

import { getClient, closeClient } from "../src/db/client.ts";
import { cleanSubgroupName } from "../src/utils.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

async function main() {
  console.log("Cleaning subgroup and diagram names...\n");

  const client = getClient(DEFAULT_CONFIG.dbPath);

  try {
    // Clean subgroup names
    const subgroups = await client.execute("SELECT id, name FROM subgroups");
    let subgroupsUpdated = 0;

    for (const row of subgroups.rows) {
      const id = row.id as string;
      const name = row.name as string;
      const cleanedName = cleanSubgroupName(name);

      if (cleanedName !== name) {
        await client.execute({
          sql: "UPDATE subgroups SET name = ? WHERE id = ?",
          args: [cleanedName, id],
        });
        subgroupsUpdated++;
        console.log(`  Subgroup: "${name}" -> "${cleanedName}"`);
      }
    }

    console.log(`\nUpdated ${subgroupsUpdated} subgroup names.\n`);

    // Clean diagram names
    const diagrams = await client.execute("SELECT id, name FROM diagrams");
    let diagramsUpdated = 0;

    for (const row of diagrams.rows) {
      const id = row.id as string;
      const name = row.name as string;
      const cleanedName = cleanSubgroupName(name);

      if (cleanedName !== name) {
        await client.execute({
          sql: "UPDATE diagrams SET name = ? WHERE id = ?",
          args: [cleanedName, id],
        });
        diagramsUpdated++;
        console.log(`  Diagram: "${name}" -> "${cleanedName}"`);
      }
    }

    console.log(`\nUpdated ${diagramsUpdated} diagram names.`);
    console.log("\nDone!");

  } finally {
    await closeClient();
  }
}

main();
