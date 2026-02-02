import type { Client } from "@libsql/client";

export async function createSchema(client: Client): Promise<void> {
  // Groups table (top-level categories)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

  // Subgroups table (subcategories)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS subgroups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id),
      path TEXT NOT NULL
    )
  `);

  // Diagrams table - represents a parts diagram image
  await client.execute(`
    CREATE TABLE IF NOT EXISTS diagrams (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id),
      subgroup_id TEXT REFERENCES subgroups(id),
      name TEXT NOT NULL,
      image_url TEXT,
      image_path TEXT,
      source_url TEXT NOT NULL
    )
  `);

  // Parts table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      detail_page_id TEXT,
      part_number TEXT NOT NULL,
      pnc TEXT,
      description TEXT,
      ref_number TEXT,
      quantity INTEGER,
      spec TEXT,
      notes TEXT,
      color TEXT,
      model_date_range TEXT,
      diagram_id TEXT NOT NULL REFERENCES diagrams(id),
      group_id TEXT NOT NULL REFERENCES groups(id),
      subgroup_id TEXT REFERENCES subgroups(id),
      replacement_part_number TEXT,
      UNIQUE(part_number, diagram_id)
    )
  `);

  // Tags table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL
    )
  `);

  // Tags to parts join table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS tags_to_parts (
      tag_id TEXT NOT NULL REFERENCES tags(id),
      part_id INTEGER NOT NULL REFERENCES parts(id),
      PRIMARY KEY (tag_id, part_id)
    )
  `);

  // Bookmarks table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE
    )
  `);

  // Scrape progress table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS scrape_progress (
      url TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      scraped_at TEXT,
      error TEXT
    )
  `);

  // Full-text search index
  await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS parts_fts USING fts5(
      part_number, description,
      content='parts', content_rowid='id'
    )
  `);

  // Triggers to keep FTS in sync
  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS parts_ai AFTER INSERT ON parts BEGIN
      INSERT INTO parts_fts(rowid, part_number, description)
      VALUES (new.id, new.part_number, new.description);
    END
  `);

  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS parts_ad AFTER DELETE ON parts BEGIN
      INSERT INTO parts_fts(parts_fts, rowid, part_number, description)
      VALUES ('delete', old.id, old.part_number, old.description);
    END
  `);

  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS parts_au AFTER UPDATE ON parts BEGIN
      INSERT INTO parts_fts(parts_fts, rowid, part_number, description)
      VALUES ('delete', old.id, old.part_number, old.description);
      INSERT INTO parts_fts(rowid, part_number, description)
      VALUES (new.id, new.part_number, new.description);
    END
  `);

  // Run migrations for existing databases BEFORE creating indexes on new columns
  await runMigrations(client);

  // Indexes for common queries
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_parts_part_number ON parts(part_number)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_parts_diagram_id ON parts(diagram_id)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_parts_pnc ON parts(pnc)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_parts_detail_page_id ON parts(detail_page_id)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_diagrams_group_id ON diagrams(group_id)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_diagrams_subgroup_id ON diagrams(subgroup_id)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_scrape_progress_status ON scrape_progress(status)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_subgroups_group_id ON subgroups(group_id)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_parts_group_id ON parts(group_id)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_parts_subgroup_id ON parts(subgroup_id)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_tags_to_parts_tag_id ON tags_to_parts(tag_id)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_tags_to_parts_part_id ON tags_to_parts(part_id)
  `);

  console.log("Database schema created successfully");
}

/**
 * Run migrations to add new columns to existing tables.
 * Each migration is idempotent - it checks if the column exists before adding.
 */
export async function runMigrations(client: Client): Promise<void> {
  // Migrate parts table
  const partsResult = await client.execute(`PRAGMA table_info(parts)`);
  const partsColumns = new Set(partsResult.rows.map((row) => row.name as string));

  const newPartsColumns = [
    { name: "detail_page_id", type: "TEXT" },
    { name: "pnc", type: "TEXT" },
    { name: "spec", type: "TEXT" },
    { name: "color", type: "TEXT" },
    { name: "model_date_range", type: "TEXT" },
    { name: "group_id", type: "TEXT REFERENCES groups(id)" },
    { name: "subgroup_id", type: "TEXT REFERENCES subgroups(id)" },
    { name: "replacement_part_number", type: "TEXT" },
  ];

  for (const col of newPartsColumns) {
    if (!partsColumns.has(col.name)) {
      console.log(`  Adding column: parts.${col.name}`);
      await client.execute(`ALTER TABLE parts ADD COLUMN ${col.name} ${col.type}`);
    }
  }

  // Drop price_usd column if it exists (no longer needed)
  if (partsColumns.has("price_usd")) {
    console.log("  Dropping column: parts.price_usd");
    await client.execute(`ALTER TABLE parts DROP COLUMN price_usd`);
  }

  // Migrate replaces_id to replacement_part_number and remove replacement rows
  await migrateReplacesIdToReplacementPartNumber(client, partsColumns);

  // Populate group_id and subgroup_id from diagrams if they're empty
  await populatePartsGroupIds(client);


  // Drop description_ja column if it exists
  if (partsColumns.has("description_ja")) {
    // Must drop triggers first since they reference description_ja
    console.log("  Dropping old FTS triggers...");
    await client.execute(`DROP TRIGGER IF EXISTS parts_ai`);
    await client.execute(`DROP TRIGGER IF EXISTS parts_ad`);
    await client.execute(`DROP TRIGGER IF EXISTS parts_au`);
    await client.execute(`DROP TABLE IF EXISTS parts_fts`);

    console.log("  Dropping column: parts.description_ja");
    await client.execute(`ALTER TABLE parts DROP COLUMN description_ja`);

    // Rebuild FTS index without description_ja
    console.log("  Rebuilding FTS index...");

    await client.execute(`
      CREATE VIRTUAL TABLE parts_fts USING fts5(
        part_number, description,
        content='parts', content_rowid='id'
      )
    `);

    // Recreate triggers
    await client.execute(`
      CREATE TRIGGER parts_ai AFTER INSERT ON parts BEGIN
        INSERT INTO parts_fts(rowid, part_number, description)
        VALUES (new.id, new.part_number, new.description);
      END
    `);

    await client.execute(`
      CREATE TRIGGER parts_ad AFTER DELETE ON parts BEGIN
        INSERT INTO parts_fts(parts_fts, rowid, part_number, description)
        VALUES ('delete', old.id, old.part_number, old.description);
      END
    `);

    await client.execute(`
      CREATE TRIGGER parts_au AFTER UPDATE ON parts BEGIN
        INSERT INTO parts_fts(parts_fts, rowid, part_number, description)
        VALUES ('delete', old.id, old.part_number, old.description);
        INSERT INTO parts_fts(rowid, part_number, description)
        VALUES (new.id, new.part_number, new.description);
      END
    `);

    // Repopulate FTS index
    console.log("  Repopulating FTS index...");
    await client.execute(`
      INSERT INTO parts_fts(rowid, part_number, description)
      SELECT id, part_number, description FROM parts
    `);
  }

  // Migrate subgroups table - add path column
  const subgroupsResult = await client.execute(`PRAGMA table_info(subgroups)`);
  const subgroupsColumns = new Set(subgroupsResult.rows.map((row) => row.name as string));

  if (!subgroupsColumns.has("path")) {
    console.log("  Adding column: subgroups.path");
    await client.execute(`ALTER TABLE subgroups ADD COLUMN path TEXT`);

    // Backfill: set path = id for existing rows
    console.log("  Backfilling subgroups.path = id");
    await client.execute(`UPDATE subgroups SET path = id WHERE path IS NULL`);
  }

  // Migrate from categories to groups/subgroups
  await migrateCategoriestoGroupsSubgroups(client);

}

/**
 * Migrate from the old categories table to the new groups/subgroups tables.
 * Also migrates diagrams.category_id to group_id and subgroup_id.
 */
async function migrateCategoriestoGroupsSubgroups(client: Client): Promise<void> {
  // Check if categories table exists
  const tablesResult = await client.execute(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='categories'
  `);

  // Check if diagrams table still has category_id column (migration incomplete or not started)
  const diagramsColsResult = await client.execute(`PRAGMA table_info(diagrams)`);
  const diagramsCols = new Set(diagramsColsResult.rows.map((row) => row.name as string));

  // If no categories table AND no category_id column, migration is complete
  if (tablesResult.rows.length === 0 && !diagramsCols.has("category_id")) {
    return; // Fully migrated
  }

  // Check if groups table already has data (partial migration)
  const groupsResult = await client.execute(`SELECT COUNT(*) as count FROM groups`);
  const groupsHaveData = (groupsResult.rows[0].count as number) > 0;

  console.log("  Migrating categories to groups/subgroups...");

  // Only insert groups/subgroups if they don't have data yet (handles partial migration)
  if (!groupsHaveData && tablesResult.rows.length > 0) {
    // Create groups from categories with no parent
    await client.execute(`
      INSERT INTO groups (id, name)
      SELECT id, name FROM categories WHERE parent_id IS NULL
    `);
    const groupsInserted = await client.execute(`SELECT COUNT(*) as count FROM groups`);
    console.log(`    Inserted ${groupsInserted.rows[0].count} groups`);

    // Create subgroups from categories with a parent
    await client.execute(`
      INSERT INTO subgroups (id, name, group_id)
      SELECT id, name, parent_id FROM categories WHERE parent_id IS NOT NULL
    `);
    const subgroupsInserted = await client.execute(`SELECT COUNT(*) as count FROM subgroups`);
    console.log(`    Inserted ${subgroupsInserted.rows[0].count} subgroups`);
  } else {
    console.log("    Groups and subgroups already populated");
  }

  if (diagramsCols.has("category_id")) {
    // Add group_id and subgroup_id columns if they don't exist
    if (!diagramsCols.has("group_id")) {
      await client.execute(`ALTER TABLE diagrams ADD COLUMN group_id TEXT`);
    }
    if (!diagramsCols.has("subgroup_id")) {
      await client.execute(`ALTER TABLE diagrams ADD COLUMN subgroup_id TEXT`);
    }

    // Update diagrams: if category_id is a subgroup, set both group_id and subgroup_id
    // If category_id is a group (no parent), set only group_id
    console.log("    Migrating diagrams.category_id to group_id/subgroup_id...");

    // First, handle diagrams pointing to subgroups
    await client.execute(`
      UPDATE diagrams
      SET subgroup_id = category_id,
          group_id = (SELECT group_id FROM subgroups WHERE subgroups.id = diagrams.category_id)
      WHERE category_id IN (SELECT id FROM subgroups)
    `);

    // Then, handle diagrams pointing directly to groups
    await client.execute(`
      UPDATE diagrams
      SET group_id = category_id,
          subgroup_id = NULL
      WHERE category_id IN (SELECT id FROM groups)
    `);

    // Drop old index first (must be before dropping the column)
    await client.execute(`DROP INDEX IF EXISTS idx_diagrams_category_id`);

    // Drop the old category_id column
    console.log("    Dropping diagrams.category_id column...");
    await client.execute(`ALTER TABLE diagrams DROP COLUMN category_id`);
  }

  // Drop the old categories table and its index
  console.log("    Dropping categories table...");
  await client.execute(`DROP INDEX IF EXISTS idx_categories_parent_id`);
  await client.execute(`DROP TABLE IF EXISTS categories`);

  console.log("  Migration complete!");
}

/**
 * Populate group_id and subgroup_id on parts from their linked diagrams.
 */
async function populatePartsGroupIds(client: Client): Promise<void> {
  // Check if there are parts with null group_id that need populating
  const checkResult = await client.execute(`
    SELECT COUNT(*) as count FROM parts WHERE group_id IS NULL
  `);

  const needsProcessing = (checkResult.rows[0].count as number) > 0;
  if (!needsProcessing) {
    return;
  }

  console.log("  Populating group_id and subgroup_id on parts from diagrams...");

  // Update parts with group_id and subgroup_id from their linked diagram
  await client.execute(`
    UPDATE parts
    SET group_id = (SELECT group_id FROM diagrams WHERE diagrams.id = parts.diagram_id),
        subgroup_id = (SELECT subgroup_id FROM diagrams WHERE diagrams.id = parts.diagram_id)
    WHERE group_id IS NULL
  `);

  const updatedResult = await client.execute(`
    SELECT COUNT(*) as count FROM parts WHERE group_id IS NOT NULL
  `);
  console.log(`  Updated ${updatedResult.rows[0].count} parts with group_id/subgroup_id`);
}

/**
 * Migrate from replaces_id to replacement_part_number.
 * For each row with replaces_id set, copy its part_number to the
 * replacement_part_number column of the row it replaces, then delete
 * the replacement row and drop the replaces_id column.
 */
async function migrateReplacesIdToReplacementPartNumber(
  client: Client,
  partsColumns: Set<string>
): Promise<void> {
  // Only run if replaces_id column exists
  if (!partsColumns.has("replaces_id")) {
    return;
  }

  // Check if there are any rows with replaces_id set
  const checkResult = await client.execute(`
    SELECT COUNT(*) as count FROM parts WHERE replaces_id IS NOT NULL
  `);

  const hasReplacementRows = (checkResult.rows[0].count as number) > 0;

  if (hasReplacementRows) {
    console.log("  Migrating replaces_id to replacement_part_number...");

    // Update the replaced parts with the replacement part number
    await client.execute(`
      UPDATE parts
      SET replacement_part_number = (
        SELECT replacement.part_number
        FROM parts replacement
        WHERE replacement.replaces_id = parts.id
      )
      WHERE id IN (SELECT replaces_id FROM parts WHERE replaces_id IS NOT NULL)
    `);

    // Count how many were updated
    const updatedResult = await client.execute(`
      SELECT COUNT(*) as count FROM parts WHERE replacement_part_number IS NOT NULL
    `);
    console.log(`    Updated ${updatedResult.rows[0].count} parts with replacement_part_number`);

    // Delete the replacement rows (rows that have replaces_id set)
    const deleteResult = await client.execute(`
      DELETE FROM parts WHERE replaces_id IS NOT NULL
    `);
    console.log(`    Deleted ${deleteResult.rowsAffected} replacement rows`);
  }

  // Drop the replaces_id column
  console.log("  Dropping replaces_id column...");
  await client.execute(`DROP INDEX IF EXISTS idx_parts_replaces_id`);
  await client.execute(`ALTER TABLE parts DROP COLUMN replaces_id`);
}
