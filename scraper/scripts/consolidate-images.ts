import { getClient, closeClient } from "../src/db/client.ts";
import { createSchema } from "../src/db/schema.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

// Extract base name from image filename (remove numeric suffix)
// e.g., "engine-rocker-cover-12159.png" -> "engine-rocker-cover"
// e.g., "automatic-transmission-a-t-brake-67980_67981.png" -> "automatic-transmission-a-t-brake"
function getBaseName(filename: string): string {
  // Remove extension
  const withoutExt = filename.replace(/\.png$/, "");
  // Remove trailing numeric suffix (handles both single numbers and underscore-separated numbers)
  // Match: -followed by digits (and optionally more _digits groups)
  return withoutExt.replace(/-[\d_]+$/, "");
}

async function main() {
  const client = getClient(DEFAULT_CONFIG.dbPath);
  await createSchema(client);

  const imagesDir = DEFAULT_CONFIG.imagesDir;

  // Get all image files
  const imageFiles: string[] = [];
  for await (const entry of Deno.readDir(imagesDir)) {
    if (entry.isFile && entry.name.endsWith(".png")) {
      imageFiles.push(entry.name);
    }
  }

  console.log(`Found ${imageFiles.length} image files`);

  // Group by base name
  const groups = new Map<string, string[]>();
  for (const file of imageFiles) {
    const base = getBaseName(file);
    if (!groups.has(base)) {
      groups.set(base, []);
    }
    groups.get(base)!.push(file);
  }

  console.log(`Found ${groups.size} unique base names`);

  // Process each group
  let consolidated = 0;
  let deleted = 0;

  for (const [baseName, files] of groups) {
    const newFilename = `${baseName}.png`;
    const newPath = `${imagesDir}/${newFilename}`;
    const dbPath = `images/${newFilename}`;

    // Keep the first file, rename it to the base name
    const keepFile = files[0];
    const keepPath = `${imagesDir}/${keepFile}`;

    if (keepFile !== newFilename) {
      // Check if target already exists
      try {
        await Deno.stat(newPath);
        // Target exists, just delete the source if different
        if (keepPath !== newPath) {
          await Deno.remove(keepPath);
        }
      } catch {
        // Target doesn't exist, rename
        await Deno.rename(keepPath, newPath);
      }
      consolidated++;
    }

    // Delete duplicate files
    for (const file of files.slice(1)) {
      const filePath = `${imagesDir}/${file}`;
      try {
        await Deno.remove(filePath);
        deleted++;
      } catch {
        // File might already be deleted
      }
    }

    // Update database: all diagrams with image_path matching any of these files
    // should now point to the new consolidated path
    const oldPaths = files.map(f => `images/${f}`);
    const placeholders = oldPaths.map(() => "?").join(", ");

    await client.execute({
      sql: `UPDATE diagrams SET image_path = ? WHERE image_path IN (${placeholders})`,
      args: [dbPath, ...oldPaths],
    });
  }

  console.log(`Consolidated ${consolidated} images`);
  console.log(`Deleted ${deleted} duplicate files`);

  // Verify
  const remaining = await client.execute(
    `SELECT COUNT(DISTINCT image_path) as count FROM diagrams WHERE image_path IS NOT NULL`
  );
  console.log(`Database now has ${remaining.rows[0].count} unique image paths`);

  await closeClient();
}

main();
