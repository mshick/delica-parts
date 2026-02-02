import { getClient, closeClient } from "../src/db/client.ts";
import { createSchema } from "../src/db/schema.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

async function main() {
  const client = getClient(DEFAULT_CONFIG.dbPath);
  await createSchema(client);

  // Get all unique image_paths and their diagram IDs
  const result = await client.execute(`
    SELECT image_path, GROUP_CONCAT(id) as diagram_ids, MIN(id) as keep_id
    FROM diagrams
    WHERE image_path IS NOT NULL
    GROUP BY image_path
    HAVING COUNT(*) > 1
  `);

  console.log(`Found ${result.rows.length} image_paths with multiple diagrams`);

  let partsUpdated = 0;
  let partsDeleted = 0;
  let diagramsDeleted = 0;

  for (const row of result.rows) {
    const keepId = row.keep_id as string;
    const allIds = (row.diagram_ids as string).split(",");
    const deleteIds = allIds.filter(id => id !== keepId);

    if (deleteIds.length === 0) continue;

    // For each diagram being deleted, update its parts to point to the kept diagram
    // But first, delete parts that would create duplicates
    for (const deleteId of deleteIds) {
      // Find parts that would create duplicates (same part_number already exists for keepId)
      const duplicateParts = await client.execute({
        sql: `SELECT p1.id
              FROM parts p1
              WHERE p1.diagram_id = ?
              AND EXISTS (
                SELECT 1 FROM parts p2
                WHERE p2.diagram_id = ?
                AND p2.part_number = p1.part_number
              )`,
        args: [deleteId, keepId],
      });

      if (duplicateParts.rows.length > 0) {
        const dupIds = duplicateParts.rows.map(r => r.id as number);
        const placeholders = dupIds.map(() => "?").join(", ");
        await client.execute({
          sql: `DELETE FROM parts WHERE id IN (${placeholders})`,
          args: dupIds,
        });
        partsDeleted += dupIds.length;
      }

      // Now update remaining parts to point to kept diagram
      const updateResult = await client.execute({
        sql: `UPDATE parts SET diagram_id = ? WHERE diagram_id = ?`,
        args: [keepId, deleteId],
      });
      partsUpdated += updateResult.rowsAffected;
    }

    // Delete the duplicate diagrams
    const placeholders = deleteIds.map(() => "?").join(", ");
    const deleteResult = await client.execute({
      sql: `DELETE FROM diagrams WHERE id IN (${placeholders})`,
      args: deleteIds,
    });
    diagramsDeleted += deleteResult.rowsAffected;
  }

  console.log(`Updated ${partsUpdated} parts to point to consolidated diagrams`);
  console.log(`Deleted ${partsDeleted} duplicate parts`);
  console.log(`Deleted ${diagramsDeleted} duplicate diagrams`);

  // Verify
  const remainingDiagrams = await client.execute(`SELECT COUNT(*) as count FROM diagrams`);
  const remainingParts = await client.execute(`SELECT COUNT(*) as count FROM parts`);
  console.log(`Database now has ${remainingDiagrams.rows[0].count} diagrams and ${remainingParts.rows[0].count} parts`);

  await closeClient();
}

main();
